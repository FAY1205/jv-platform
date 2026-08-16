import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { LeadNotFoundError } from "@/modules/leads/errors";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { leadWhere, tenantWhere, type ScopeContext } from "@/lib/scope";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { nextTagColor, type TagColor } from "@/lib/tokens/tokens";
import type { CreateTagInput, UpdateTagInput } from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Lead tags (TAG-01..07) — tenant-owned workflow LABELS on a lead.
//
// SCOPE (TAG-02). Tags are ADMIN-ONLY in v1 (owner decision at mockup sign-off: they are
// operator workflow labels, and partners never see them — the notes-isolation instinct).
// That makes the predicate plain `tenantWhere`, with the ADMIN half enforced at the route
// boundary by `requireAdminResponse` (every tag route carries it, like the other admin-only
// surfaces). The predicate deliberately stays HERE rather than in lib/scope.ts: scope.ts
// holds the builders whose shape is non-obvious — the ones that encode a visibility RULE
// (two-stream notes/tasks, partner lead ownership). A bare tenant filter carries no rule to
// centralise, and adding a `tagWhere` alias there would suggest tags have a role dimension
// they do not have. If a partner-facing tag stream is ever decided, THAT is the moment the
// predicate becomes a rule and moves to scope.ts beside noteWhere/taskWhere (and gains an
// author_role column + a second RLS arm). The RLS policies `tags_scope` / `lead_tags_scope`
// (migration 0042) carry the identical READ predicate plus the admin pin, and their WITH
// CHECK halves additionally pin writer identity and BOTH in-tenant references (SEC-01) —
// keep all of it in lockstep with the builders below.
//
// DM-08 is N/A: tags are tenant-editable workflow data, not RULES (patterns, coverage,
// recodes, Source Profiles). A rename/recolor/delete therefore does NOT produce a rules
// snapshot — nothing about lead routing or MLS verdicts depends on a tag.
//
// TAG-07 (recorded decision): attach/detach write an audit_log entry ONLY — never a
// timeline entry. Tagging is a high-frequency labelling gesture; threading it through the
// lead timeline would bury the status/note/task events the timeline exists to show. The
// audit trail keeps the full who/when for compliance. Revisit only if an operator asks.
//
// PII: a tag NAME is a workflow label an operator typed for their own filing ("Probate",
// "Cash buyer ask") — not seller data — so audit payloads carry it PLAIN, unlike note
// bodies and task titles which are masked (SEC-05, ADR-0031). The lead's ref id travels
// with attach/detach entries for the same reason it does on tasks: it is the audit's
// human-readable handle, and it is already all over the admin surface.
//
// "Not PII" is NOT "not user-originated" (audit-tenancy F-9). A tag name is free text an
// operator typed, so any FUTURE surface that renders it into a spreadsheet or an email must
// treat it like every other user cell: run it through `sanitizeCell` before it reaches a
// CSV/Excel cell (SEC-06 formula injection), and escape it in HTML mail. No export or email
// path carries tags today — this line exists so the one that does starts from the rule.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

export class TagNotFoundError extends Error {
  constructor(id: string) {
    super(`Tag ${id} not found.`);
    this.name = "TagNotFoundError";
  }
}
// LeadNotFoundError is shared (C-5) — re-export the one class so every route's instanceof matches.
export { LeadNotFoundError };
/** TAG-01: names are unique per tenant, case-insensitively. */
export class DuplicateTagNameError extends Error {
  constructor(name: string) {
    super(`A tag called "${name}" already exists.`);
    this.name = "DuplicateTagNameError";
  }
}
/** TAG-02: tags are admin-only in v1 — a partner scope reaching a tag read is a programming
 *  error (the routes 403 first), not a user-facing condition. */
export class TagScopeError extends Error {
  constructor() {
    super("Tags are admin-only.");
    this.name = "TagScopeError";
  }
}

/** Tag visibility: tenant-only (the admin half is the route gate — see the header). */
export function tagWhere(scope: ScopeContext) {
  return tenantWhere(schema.tags, scope);
}

/** Attachment visibility: the same tenant-only predicate on the junction. */
export function leadTagWhere(scope: ScopeContext) {
  return tenantWhere(schema.leadTags, scope);
}

export interface TagView {
  id: string;
  name: string;
  color: string;
}

/** TAG-06: the Settings manager's row — a tag plus how many leads currently carry it. */
export interface TagWithUsage extends TagView {
  leadCount: number;
}

/** The index the case-insensitive name rule is enforced by (migration 0042). */
const TAG_NAME_INDEX = "tags_tenant_name_idx";

/**
 * The unique index is the ONLY duplicate check (TAG-01): a read-then-write pre-check races
 * two concurrent creates into two rows differing only in case. Map the 23505 instead — but
 * ONLY the one the NAME index raised (audit-tenancy F-6). `lead_tags_lead_tag_idx` also
 * raises 23505, and a blanket mapping would have reported an unrelated junction conflict as
 * `A tag called "" already exists.` — a wrong, and on a color-only PATCH nonsensical,
 * message. Anything else propagates as the 500 it is.
 */
function asDuplicate(e: unknown, name: string | undefined): unknown {
  const info = pgErrorInfo(e);
  if (info.code !== "23505" || info.constraint !== TAG_NAME_INDEX || name === undefined) return e;
  return new DuplicateTagNameError(name);
}

/**
 * TAG-06 — every tag in the tenant with its live usage count. A LEFT JOIN + group-by, not
 * N+1 counts. Attachments on RECALLED (soft-deleted) leads are excluded so the count the
 * delete confirmation shows matches what an operator can actually see on the leads list.
 */
export async function listTags(scope: ScopeContext): Promise<TagWithUsage[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      color: schema.tags.color,
      // Counts the LEAD, not the junction row: the leads join below filters recalled
      // (soft-deleted) leads, and on a LEFT JOIN their junction rows survive with a null
      // lead — counting `leadTags.id` would keep counting them.
      leadCount: sql<number>`count(${schema.leads.id})::int`,
    })
    .from(schema.tags)
    .leftJoin(
      schema.leadTags,
      // ADR-0013 defence-in-depth: the join carries its own tenant predicate, so a
      // mis-tenanted junction row can never inflate another tenant's count.
      and(eq(schema.leadTags.tagId, schema.tags.id), tenantWhere(schema.leadTags, scope)),
    )
    .leftJoin(
      schema.leads,
      and(eq(schema.leads.id, schema.leadTags.leadId), tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt)),
    )
    .where(tagWhere(scope))
    .groupBy(schema.tags.id, schema.tags.name, schema.tags.color)
    .orderBy(sql`lower(${schema.tags.name})`);
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, leadCount: Number(r.leadCount) }));
}

/**
 * TAG-03/TAG-04 — create a tag. `color` omitted means "the next palette color, round-robin"
 * (the picker's create-inline path sends a name only).
 *
 * The round-robin is BEST-EFFORT. The count is read inside the transaction, but under READ
 * COMMITTED two concurrent creates can still both observe the same count and pick the same
 * slot. That is deliberate: the consequence is cosmetic — two tags sharing a hue — and it is
 * NOT an information problem, because a chip always renders its name (PRN-14) and the color
 * can be changed in Settings (TAG-06). Serializing tag creation behind a lock to make a
 * color choice unique would be a real cost for a decorative guarantee.
 */
export async function createTag(
  scope: ScopeContext,
  input: CreateTagInput,
  traceId?: string,
): Promise<{ id: string; name: string; color: TagColor }> {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const color = input.color ?? nextTagColor(await countTags(tx, scope));
      const [tag] = await tx
        .insert(schema.tags)
        .values({ tenantId: scope.tenantId, name: input.name, color })
        .returning({ id: schema.tags.id });
      await tx.insert(schema.auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: scope.userId,
        action: "tag.created",
        entityType: "tag",
        entityRef: tag.id,
        before: null,
        // Plain, not masked: a tag name is a workflow label, not PII (see the header).
        after: { name: input.name, color },
        traceId: traceId ?? null,
      });
      return { id: tag.id, name: input.name, color };
    });
  } catch (e) {
    throw asDuplicate(e, input.name);
  }
}

async function countTags(db: DB, scope: ScopeContext): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.tags).where(tagWhere(scope));
  return Number(row?.n ?? 0);
}

/** Re-resolve a tag through the scope guard. `tagWhere ∩ id` is the whole authorization:
 *  a tag id from another tenant simply does not resolve (PRN-08). */
async function resolveTag(db: DB, scope: ScopeContext, tagId: string) {
  const [tag] = await db
    .select({ id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
    .from(schema.tags)
    .where(and(tagWhere(scope), eq(schema.tags.id, tagId)));
  if (!tag) throw new TagNotFoundError(tagId);
  return tag;
}

/** Resolve a lead the caller may tag, by reference id — the ONLY source of `lead_id` and
 *  `tenant_id` on the write path (never a raw id off the request). Recalled leads are
 *  excluded: a voided lead is not a working surface. */
async function resolveLead(db: DB, scope: ScopeContext, leadRefId: string) {
  const [lead] = await db
    .select({ id: schema.leads.id, tenantId: schema.leads.tenantId })
    .from(schema.leads)
    .where(and(leadWhere(scope), eq(schema.leads.refId, leadRefId), isNull(schema.leads.deletedAt)));
  if (!lead) throw new LeadNotFoundError(leadRefId);
  return lead;
}

/** TAG-06 — rename and/or recolor. Scoped write (not a bare id), audited before→after. */
export async function updateTag(
  scope: ScopeContext,
  tagId: string,
  patch: UpdateTagInput,
  traceId?: string,
): Promise<void> {
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const tag = await resolveTag(tx, scope, tagId);
      const next = { name: patch.name ?? tag.name, color: patch.color ?? tag.color };
      await tx
        .update(schema.tags)
        .set({ ...next, updatedAt: sql`now()` })
        .where(and(tagWhere(scope), eq(schema.tags.id, tagId)));
      await tx.insert(schema.auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: scope.userId,
        action: "tag.updated",
        entityType: "tag",
        entityRef: tagId,
        before: { name: tag.name, color: tag.color },
        after: next,
        traceId: traceId ?? null,
      });
    });
  } catch (e) {
    // `patch.name` undefined ⇒ a color-only PATCH, which cannot collide on the name index:
    // asDuplicate passes such an error straight through rather than inventing a name clash.
    throw asDuplicate(e, patch.name);
  }
}

/**
 * TAG-03/TAG-06 — delete a tag. Detaching everywhere and removing the tag happen in ONE
 * transaction, so a lead can never be left pointing at a tag that no longer exists (and the
 * junction's FK can never fail the delete). The confirmation is a CLIENT concern (the
 * Settings dialog shows the usage count); the server just does what it is told, once.
 */
export async function deleteTag(scope: ScopeContext, tagId: string, traceId?: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const tag = await resolveTag(tx, scope, tagId);
    const detached = await tx
      .delete(schema.leadTags)
      .where(and(leadTagWhere(scope), eq(schema.leadTags.tagId, tagId)))
      .returning({ id: schema.leadTags.id });
    await tx.delete(schema.tags).where(and(tagWhere(scope), eq(schema.tags.id, tagId)));
    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "tag.deleted",
      entityType: "tag",
      entityRef: tagId,
      before: { name: tag.name, color: tag.color },
      // The detach count is the compliance-relevant fact: one entry says how much the
      // delete swept, instead of N per-attachment rows for a routine cleanup.
      after: { detached: detached.length },
      traceId: traceId ?? null,
    });
  });
}

/**
 * TAG-03 — attach a tag to a lead. IDEMPOTENT: the (lead_id, tag_id) unique index absorbs a
 * repeat via onConflictDoNothing, and an attach that changed nothing writes NO audit entry
 * (a double-click is one attachment, not two trail rows). Both references are re-resolved
 * under the tenant predicate first, so a foreign lead ref or a foreign tag id 404s rather
 * than crossing the boundary — the app-layer half of the RLS WITH CHECK.
 */
export async function attachTag(
  scope: ScopeContext,
  leadRefId: string,
  tagId: string,
  traceId?: string,
): Promise<{ attached: boolean }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const lead = await resolveLead(tx, scope, leadRefId);
    const tag = await resolveTag(tx, scope, tagId);
    const inserted = await tx
      .insert(schema.leadTags)
      .values({ tenantId: lead.tenantId, leadId: lead.id, tagId: tag.id, addedByUserId: scope.userId })
      .onConflictDoNothing({ target: [schema.leadTags.leadId, schema.leadTags.tagId] })
      .returning({ id: schema.leadTags.id });
    if (inserted.length === 0) return { attached: false }; // already on the lead — no-op
    await tx.insert(schema.auditLog).values({
      tenantId: lead.tenantId,
      actorUserId: scope.userId,
      action: "tag.attached",
      entityType: "lead_tag",
      entityRef: inserted[0].id,
      before: null,
      after: { tagId: tag.id, name: tag.name, leadRefId },
      traceId: traceId ?? null,
    });
    return { attached: true };
  });
}

/** TAG-03 — detach. IDEMPOTENT in the same way: removing a tag that isn't on the lead is a
 *  no-op that writes nothing. Fully scoped DELETE (tenant + resolved lead + resolved tag). */
export async function detachTag(
  scope: ScopeContext,
  leadRefId: string,
  tagId: string,
  traceId?: string,
): Promise<{ detached: boolean }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const lead = await resolveLead(tx, scope, leadRefId);
    const tag = await resolveTag(tx, scope, tagId);
    const removed = await tx
      .delete(schema.leadTags)
      .where(and(leadTagWhere(scope), eq(schema.leadTags.leadId, lead.id), eq(schema.leadTags.tagId, tag.id)))
      .returning({ id: schema.leadTags.id });
    if (removed.length === 0) return { detached: false };
    await tx.insert(schema.auditLog).values({
      tenantId: lead.tenantId,
      actorUserId: scope.userId,
      action: "tag.detached",
      entityType: "lead_tag",
      entityRef: removed[0].id,
      before: { tagId: tag.id, name: tag.name, leadRefId },
      after: null,
      traceId: traceId ?? null,
    });
    return { detached: true };
  });
}

/** The tags on ONE lead (the dialog / a post-mutation refetch). */
export async function listLeadTags(scope: ScopeContext, leadRefId: string): Promise<TagView[]> {
  const db = getDb();
  await resolveLead(db, scope, leadRefId);
  return (await tagsByLeadRef(db, scope, [leadRefId])).get(leadRefId) ?? [];
}

/**
 * TAG-04 — the chips for a PAGE of leads, in ONE round trip (never N+1 per row). Keyed by
 * lead REF so the list and the board — which project a refId, not a lead id — share one
 * loader. Tenant-scoped on every table in the join (ADR-0013 defence-in-depth); ordering is
 * by lower(name) so a row's chips (and therefore which two survive the card's cap) are
 * stable between renders.
 *
 * ADMIN-ONLY, enforced HERE and not only at the route (audit-tenancy F-2). Every other
 * function in this module resolves its own inputs from the tenant-scoped tables; this one
 * takes lead refs FROM A CALLER, so its safety cannot rest on the tag routes' admin gates —
 * it is called from `listLeads`, which is not a tags route at all. `listLeadsBoard` sets the
 * precedent: a module whose read is admin-only says so itself rather than trusting every
 * present and future caller to have been gated. Revisit only if a partner-facing tag stream
 * is decided — at which point this needs a partner arm, not a relaxed guard.
 */
export async function tagsByLeadRef(
  db: DB,
  scope: ScopeContext,
  leadRefIds: readonly string[],
): Promise<Map<string, TagView[]>> {
  if (scope.role !== "admin") throw new TagScopeError();
  const byRef = new Map<string, TagView[]>();
  if (leadRefIds.length === 0) return byRef;
  const rows = await db
    .select({
      refId: schema.leads.refId,
      id: schema.tags.id,
      name: schema.tags.name,
      color: schema.tags.color,
    })
    .from(schema.leadTags)
    .innerJoin(schema.leads, and(eq(schema.leads.id, schema.leadTags.leadId), tenantWhere(schema.leads, scope)))
    .innerJoin(schema.tags, and(eq(schema.tags.id, schema.leadTags.tagId), tenantWhere(schema.tags, scope)))
    .where(and(leadTagWhere(scope), inArray(schema.leads.refId, [...leadRefIds])))
    .orderBy(sql`lower(${schema.tags.name})`, asc(schema.tags.id));
  for (const r of rows) {
    const list = byRef.get(r.refId);
    const view = { id: r.id, name: r.name, color: r.color };
    if (list) list.push(view);
    else byRef.set(r.refId, [view]);
  }
  return byRef;
}
