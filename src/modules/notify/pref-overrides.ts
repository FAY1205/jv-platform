import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantIdWhere } from "@/lib/scope";
import {
  NOTIFICATION_EVENTS,
  resolvePref,
  type NotifChannel,
  type NotifEvent,
  type NotifRole,
  type NotificationPrefs,
} from "./prefs";

// ─────────────────────────────────────────────────────────────────────────────
// Per-SUBJECT notification preference overlay (NTF-10, WP-NF2).
//
// Tenant prefs (settings.notification_prefs, per ROLE bucket) remain the BASE. This
// module adds a second, narrower layer: one `notification_pref_overrides` row per
// SUBJECT — either a USER seat, or a PARTNER ORG (which gates the org-addressed
// `partners.email` digests/alerts, a surface no seat owns). Exactly one of the two,
// enforced by the migration 0057 CHECK.
//
// Two invariants the resolution below encodes and the tests pin:
//  • The overlay is applied FIELD-WISE, so a subject who has only ever touched the email
//    leg of one event still inherits every later tenant-level change on every other leg.
//    A whole-object overwrite would silently freeze that subject's prefs at the shape
//    they had the day they first clicked something.
//  • `allEmailsOff` is an EMAIL kill switch and never touches in-app (NTF-13 / §10.7):
//    unsubscribing from email must not silently blind someone's notification bell.
//
// The table also carries the split unsubscribe capability (token_id + token_secret,
// NTF-13). Minting lives here because a token is created lazily by the first email
// enqueued to a subject — i.e. exactly where the overlay is already being read.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;
const overrides = schema.notificationPrefOverrides;

/** Every event key in the catalog, de-duplicated across role buckets (`hot_leads` and
 *  `task_due` exist in both). An overlay is keyed by event ALONE: a subject reads exactly
 *  one role bucket (streamPrefRole), so the role is never ambiguous at resolution time. */
export const NOTIFICATION_EVENT_KEYS: readonly NotifEvent[] = [
  ...new Set(NOTIFICATION_EVENTS.map((e) => e.key)),
];

const isEventKey = (key: string): key is NotifEvent =>
  (NOTIFICATION_EVENT_KEYS as readonly string[]).includes(key);

const OverlayChannelSchema = z.object({ email: z.boolean(), inApp: z.boolean() }).partial().strict();

/** The per-event overlay map. Keys are spelled out (not derived) for the same reason
 *  `NotificationPrefsSchema` spells out the tenant shape — an explicit literal is what makes
 *  the inferred type exact. They MUST mirror NOTIFICATION_EVENTS; "NTF-10: the overlay schema
 *  covers exactly the event catalog" fails the build if the two ever drift. */
const EventOverlaySchema = z
  .object({
    run_summary: OverlayChannelSchema,
    hot_leads: OverlayChannelSchema,
    status_change: OverlayChannelSchema,
    task_due: OverlayChannelSchema,
    new_leads: OverlayChannelSchema,
    assigned_lead: OverlayChannelSchema,
  })
  .partial()
  .strict();

/**
 * The stored `value` shape. Every key is optional — an absent leg means "inherit the tenant
 * default", which is what keeps the field-wise merge honest. Unknown keys are REJECTED
 * (`.strict()`), so a caller cannot smuggle arbitrary keys into the jsonb column and a
 * retired event cannot leave an unreadable entry behind.
 */
export const PrefOverrideValueSchema = z
  .object({ events: EventOverlaySchema, allEmailsOff: z.boolean() })
  .partial()
  .strict();

export type PrefOverrideValue = z.infer<typeof PrefOverrideValueSchema>;

/** Parse a stored jsonb value. An unparseable row resolves to NO overlay rather than an
 *  error: a corrupt preference must never be able to drop a notification (the PRN-11
 *  posture `loadNotificationPrefs` already takes for the tenant row). */
export function parseOverrideValue(raw: unknown): PrefOverrideValue | null {
  const parsed = PrefOverrideValueSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

/**
 * NTF-10 resolution. PURE.
 *
 * tenant `resolvePref` → the subject's field-wise overlay → then `email &&= !allEmailsOff`.
 * The kill switch is applied LAST and only to email, so a subject who explicitly turned an
 * event's email back ON is still covered by a later "pause all emails", and no ordering of
 * the two switches can leave in-app off.
 */
export function resolveEffectiveChannel(
  prefs: NotificationPrefs,
  overlay: PrefOverrideValue | null | undefined,
  role: NotifRole,
  event: NotifEvent,
): NotifChannel {
  const base = resolvePref(prefs, role, event);
  const over = overlay?.events?.[event];
  const inApp = over?.inApp ?? base.inApp;
  const email = (over?.email ?? base.email) && !overlay?.allEmailsOff;
  return { email, inApp };
}

/** One row of the self-serve preferences view (NTF-15). `overridden` says which legs this
 *  subject has PINNED — the UI needs it to show "you changed this" and to explain why a
 *  tenant-default change did not move it. */
export interface SubjectPrefEvent {
  key: NotifEvent;
  label: string;
  effective: NotifChannel;
  overridden: { email: boolean; inApp: boolean };
}

export interface SubjectPrefsView {
  role: NotifRole;
  allEmailsOff: boolean;
  events: SubjectPrefEvent[];
}

/** NTF-15: the caller's own resolved preferences, for their OWN role bucket only. PURE. */
export function describeSubjectPrefs(
  prefs: NotificationPrefs,
  overlay: PrefOverrideValue | null,
  role: NotifRole,
): SubjectPrefsView {
  return {
    role,
    allEmailsOff: overlay?.allEmailsOff === true,
    events: NOTIFICATION_EVENTS.filter((e) => e.role === role).map((e) => {
      const over = overlay?.events?.[e.key];
      return {
        key: e.key,
        label: e.label,
        effective: resolveEffectiveChannel(prefs, overlay, role, e.key),
        overridden: { email: over?.email !== undefined, inApp: over?.inApp !== undefined },
      };
    }),
  };
}

/** A PARTNER-ORG subject has no in-app surface (notifications are per user), so only the
 *  email leg of an org overlay is meaningful. Same resolution, named for the one leg it
 *  can answer — so a call site cannot accidentally gate an in-app row on an org row. */
export function resolveOrgEmail(
  prefs: NotificationPrefs,
  overlay: PrefOverrideValue | null | undefined,
  event: NotifEvent,
): boolean {
  return resolveEffectiveChannel(prefs, overlay, "partner", event).email;
}

/**
 * Batch-load the overlays for a fan-out's recipients, keyed by user id. ONE query per
 * fan-out, not one per recipient (a 40-seat digest must not become 40 round trips).
 * Users with no row are simply absent from the map — the caller then resolves against the
 * tenant defaults alone, which is byte-identical to pre-NTF-10 behavior.
 *
 * PRN-08: tenant-pinned through the shared builder, so a user id from another tenant
 * returns nothing even though `users.id` is globally unique.
 */
export async function loadOverridesFor(
  db: DB,
  tenantId: string,
  userIds: readonly string[],
): Promise<Map<string, PrefOverrideValue>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, PrefOverrideValue>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ userId: overrides.userId, value: overrides.value })
    .from(overrides)
    .where(and(tenantIdWhere(overrides, tenantId), inArray(overrides.userId, ids)));
  for (const row of rows) {
    const value = parseOverrideValue(row.value);
    if (row.userId && value) out.set(row.userId, value);
  }
  return out;
}

/** A subject's already-minted token, as `"{token_id}.{token_secret}"`. */
export type SubjectToken = string;

/**
 * Batch-load the EXISTING unsubscribe tokens for a set of user subjects, keyed by user id.
 *
 * The companion to `loadOverridesFor`, and the reason the reminder sweep is not N+1: without
 * it, every task in a tick called `ensureSubjectToken`, which is a SELECT (plus, once per
 * subject ever, an INSERT). A 200-task tick paid 200 round trips to fetch at most a handful of
 * distinct tokens. Subjects with no row yet are simply absent — the caller falls back to
 * `ensureSubjectToken` for those, so first-ever sends still mint correctly.
 *
 * PRN-08: tenant-pinned through the shared builder.
 */
export async function loadTokensFor(
  db: DB,
  tenantId: string,
  userIds: readonly string[],
): Promise<Map<string, SubjectToken>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, SubjectToken>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ userId: overrides.userId, tokenId: overrides.tokenId, tokenSecret: overrides.tokenSecret })
    .from(overrides)
    .where(and(tenantIdWhere(overrides, tenantId), inArray(overrides.userId, ids)));
  for (const row of rows) if (row.userId) out.set(row.userId, `${row.tokenId}.${row.tokenSecret}`);
  return out;
}

/** The PARTNER-ORG twin of `loadOverridesFor`, keyed by partner id — one query for a whole
 *  run's org-addressed digests rather than one per partner. PRN-08: tenant-pinned. */
export async function loadPartnerOverridesFor(
  db: DB,
  tenantId: string,
  partnerIds: readonly string[],
): Promise<Map<string, PrefOverrideValue>> {
  const ids = [...new Set(partnerIds)];
  const out = new Map<string, PrefOverrideValue>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ partnerId: overrides.partnerId, value: overrides.value })
    .from(overrides)
    .where(and(tenantIdWhere(overrides, tenantId), inArray(overrides.partnerId, ids)));
  for (const row of rows) {
    const value = parseOverrideValue(row.value);
    if (row.partnerId && value) out.set(row.partnerId, value);
  }
  return out;
}

/** The PARTNER-ORG overlay for one org, or null when it has never been touched. PRN-08:
 *  tenant-pinned — a partner id alone is not a scope. */
export async function loadPartnerOverride(
  db: DB,
  tenantId: string,
  partnerId: string,
): Promise<PrefOverrideValue | null> {
  const [row] = await db
    .select({ value: overrides.value })
    .from(overrides)
    .where(and(tenantIdWhere(overrides, tenantId), eq(overrides.partnerId, partnerId)));
  return row ? parseOverrideValue(row.value) : null;
}

/** The subject an overlay row belongs to: a seat, or a partner org. Never both (0057 CHECK). */
export type OverrideSubject = { userId: string } | { partnerId: string };

/** The predicate for one subject, tenant-pinned (PRN-08). The NULL leg is stated explicitly so
 *  the partial unique index that guarantees at-most-one row is the index this read uses. */
function subjectWhere(tenantId: string, subject: OverrideSubject) {
  return "userId" in subject
    ? and(tenantIdWhere(overrides, tenantId), eq(overrides.userId, subject.userId), isNull(overrides.partnerId))
    : and(tenantIdWhere(overrides, tenantId), eq(overrides.partnerId, subject.partnerId), isNull(overrides.userId));
}

/**
 * PRN-08 / TST-01c: prove the subject actually belongs to `tenantId` before anything mints a
 * capability for it.
 *
 * This matters more here than at a normal read. `ensureSubjectToken` is the ONE statement in
 * the module that CREATES an unsubscribe capability, and its insert would otherwise take the
 * caller's `tenantId` and the caller's subject id on trust — a mismatched pair would mint a
 * live token whose row claims tenant A while pointing at tenant B's seat. There is no RLS
 * backstop to catch it either: the table is deny-by-default and every writer is the service
 * role (ADR-0013 — the app layer IS the boundary here). One indexed read, tenant-pinned
 * through the shared builder, is the whole cost.
 *
 * Throws rather than returning a verdict: a caller that has reached this line with a foreign
 * subject has a bug, and the emit sites are all best-effort (they log ids and move on), so a
 * throw degrades one notification rather than silently issuing a cross-tenant capability.
 */
async function assertSubjectInTenant(db: DB, tenantId: string, subject: OverrideSubject): Promise<void> {
  if ("userId" in subject) {
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(tenantIdWhere(schema.users, tenantId), eq(schema.users.id, subject.userId)));
    if (!row) throw new Error("ensureSubjectToken: refusing to mint a token for a user outside this tenant.");
    return;
  }
  const [row] = await db
    .select({ id: schema.partners.id })
    .from(schema.partners)
    .where(and(tenantIdWhere(schema.partners, tenantId), eq(schema.partners.id, subject.partnerId)));
  if (!row) throw new Error("ensureSubjectToken: refusing to mint a token for a partner outside this tenant.");
}

/** Random base64url of `bytes` entropy. 18B for the public id, 32B for the secret half. */
function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** 18 bytes, not 16, so the base64url id half is 24 characters — the threshold at which the
 *  observability scrubber's generic ≥24-char high-entropy token rule recognises it. The id is
 *  the half most likely to reach a log line (it is the DB lookup key), so it is worth the two
 *  extra bytes to have the scrubber catch it even where a call site forgets. */
export const TOKEN_ID_BYTES = 18;
export const TOKEN_SECRET_BYTES = 32;

/**
 * NTF-13: get-or-create the subject's overlay row and return its unsubscribe token
 * `"{token_id}.{token_secret}"`. Minted LAZILY — a tenant that never emails never grows a
 * row, and a subject's token is stable across every email it ever receives, so an old link
 * in an old inbox keeps working.
 *
 * The insert races the per-subject partial unique index rather than reading-then-writing
 * under a lock: two concurrent fan-outs to the same seat both attempt, one wins, and the
 * loser re-reads the winner's row. The token a subject holds therefore never changes.
 *
 * SEC-05: the token is returned to the CALLER to place in a link; it is never logged.
 */
export async function ensureSubjectToken(
  db: DB,
  tenantId: string,
  subject: OverrideSubject,
): Promise<{ token: string }> {
  const where = subjectWhere(tenantId, subject);
  await assertSubjectInTenant(db, tenantId, subject);
  const [existing] = await db
    .select({ tokenId: overrides.tokenId, tokenSecret: overrides.tokenSecret })
    .from(overrides)
    .where(where);
  if (existing) return { token: `${existing.tokenId}.${existing.tokenSecret}` };

  const minted = await db
    .insert(overrides)
    .values({
      tenantId,
      userId: "userId" in subject ? subject.userId : null,
      partnerId: "partnerId" in subject ? subject.partnerId : null,
      tokenId: randomToken(TOKEN_ID_BYTES),
      tokenSecret: randomToken(TOKEN_SECRET_BYTES),
    })
    .onConflictDoNothing()
    .returning({ tokenId: overrides.tokenId, tokenSecret: overrides.tokenSecret });
  if (minted.length > 0) return { token: `${minted[0].tokenId}.${minted[0].tokenSecret}` };

  // Lost the race: the winner's row is now the subject's one row.
  const [raced] = await db
    .select({ tokenId: overrides.tokenId, tokenSecret: overrides.tokenSecret })
    .from(overrides)
    .where(where);
  if (!raced) throw new Error("ensureSubjectToken: overlay row vanished after a conflicting insert.");
  return { token: `${raced.tokenId}.${raced.tokenSecret}` };
}

/** The subject's overlay row + token, get-or-create. Used by the self-serve prefs API, which
 *  needs the row to exist before it can upsert a value onto it. */
export async function loadSubjectOverride(
  db: DB,
  tenantId: string,
  subject: OverrideSubject,
): Promise<PrefOverrideValue | null> {
  const [row] = await db.select({ value: overrides.value }).from(overrides).where(subjectWhere(tenantId, subject));
  return row ? parseOverrideValue(row.value) : null;
}

/**
 * NTF-15: upsert a subject's overlay value (whole-value replace — the API's PUT sends the
 * complete overlay it just rendered, so a field dropped from the payload means "inherit the
 * tenant default" again). Mints the token halves on first write so the row is immediately
 * unsubscribe-capable. `updated_at` is `now()` in SQL, never a client clock.
 */
export async function saveSubjectOverride(
  db: DB,
  tenantId: string,
  subject: OverrideSubject,
  value: PrefOverrideValue,
): Promise<PrefOverrideValue> {
  // ONE transaction: the get-or-create and the value write are a single logical save. Split
  // across two autocommits, a failure between them leaves a row that exists with an empty
  // value — i.e. a save the user was told nothing about, silently discarded, while the token
  // it minted persists. Both statements are already single-row and indexed, so the transaction
  // costs a round trip and buys atomicity.
  await db.transaction(async (tx) => {
    await ensureSubjectToken(tx, tenantId, subject);
    await tx
      .update(overrides)
      .set({ value, updatedAt: sql`now()` })
      .where(subjectWhere(tenantId, subject));
  });
  return value;
}

export { isEventKey };
