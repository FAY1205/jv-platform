import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { timingSafeEqualStr } from "@/lib/auth/constant-time";
import type { UnsubscribeLinks } from "./email-template";
import { NOTIFICATION_EVENTS, type NotifEvent, type NotifRole } from "./prefs";
import {
  ensureSubjectToken,
  isEventKey,
  parseOverrideValue,
  TOKEN_SECRET_BYTES,
  type OverrideSubject,
  type PrefOverrideValue,
} from "./pref-overrides";

// ─────────────────────────────────────────────────────────────────────────────
// Tokenized unsubscribe (NTF-13).
//
// The token is a SPLIT capability `"{token_id}.{secret}"`: the id is the lookup key, the
// secret is the proof. There is no app-wide HMAC secret in lib/env, so the secret half is
// stored (see the accepted-risk note in WP-NF2 §4) — but it is still compared with
// `timingSafeEqual`, never `===` (AUT-09).
//
// AUT-05 posture, and the reason this file returns `void` rather than a verdict: the
// endpoint's response must be IDENTICAL for a valid token, an invalid one, a malformed one,
// and one whose subject no longer exists. A caller that could distinguish them would have an
// oracle for "is this address on the platform" — from an unauthenticated endpoint whose whole
// input is a string harvested out of an email. So the timing is levelled too: when no row
// matches we still run one equal-length comparison against a constant dummy before returning.
//
// The capability is deliberately narrow — it can only REDUCE email. It never touches in-app
// (§10.7), never reveals or changes an address, and never grants a session.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;
const overrides = schema.notificationPrefOverrides;

/** The public path an unsubscribe link points at. One constant so the page, the links, and
 *  the tests cannot drift. */
export const UNSUBSCRIBE_PATH = "/unsubscribe";

/** The catalog's human label for a role+event, for the "Unsubscribe from {label}" line.
 *  Falls back to the raw key so a footer can never render "undefined". PURE. */
export function unsubscribeEventLabel(role: NotifRole, event: NotifEvent): string {
  return NOTIFICATION_EVENTS.find((e) => e.role === role && e.key === event)?.label ?? event;
}

/** The two footer URLs for one recipient + event. PURE — the base origin (env.APP_URL) and the
 *  token are supplied by the caller, so nothing here reads the environment or the clock. */
export function buildUnsubscribeLinks(input: {
  baseUrl: string;
  token: string;
  role: NotifRole;
  event: NotifEvent;
}): UnsubscribeLinks {
  const link = (event: string) =>
    `${input.baseUrl}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(input.token)}&event=${encodeURIComponent(event)}`;
  return {
    typeUrl: link(input.event),
    typeLabel: unsubscribeEventLabel(input.role, input.event),
    allUrl: link("all"),
  };
}

/** Mint-or-reuse the subject's token and build its footer links — the one line every retrofit
 *  emit site calls before enqueueing. */
export async function subjectUnsubscribeLinks(
  db: DB,
  tenantId: string,
  subject: OverrideSubject,
  opts: { baseUrl: string; role: NotifRole; event: NotifEvent },
): Promise<UnsubscribeLinks> {
  const { token } = await ensureSubjectToken(db, tenantId, subject);
  return buildUnsubscribeLinks({ baseUrl: opts.baseUrl, token, role: opts.role, event: opts.event });
}

/** Request body. `event` is a catalog key or the literal "all"; validated as a bounded string
 *  here and resolved against the catalog during apply, so an unknown-but-well-formed key
 *  takes the same silent-success path as a bad token (AUT-05) instead of a distinct 400. */
export const UnsubscribeRequestSchema = z
  .object({ token: z.string().min(1).max(512), event: z.string().min(1).max(64) })
  .strict();

export type UnsubscribeRequest = z.infer<typeof UnsubscribeRequestSchema>;

/** A constant of the SAME length a real secret has, so the no-row branch does the same work as
 *  the row branch. base64url is unpadded, so N bytes encode to ceil(N * 4 / 3) characters. */
export const DUMMY_SECRET = "A".repeat(Math.ceil((TOKEN_SECRET_BYTES * 4) / 3));

/** Split `"{id}.{secret}"`. A token with no separator yields empty halves, which then take the
 *  no-row path — the same path, and the same timing, as a wrong secret. */
function splitToken(token: string): { tokenId: string; secret: string } {
  const dot = token.indexOf(".");
  if (dot <= 0) return { tokenId: "", secret: "" };
  return { tokenId: token.slice(0, dot), secret: token.slice(dot + 1) };
}

/** The overlay value after applying one unsubscribe. PURE, and idempotent: re-applying the
 *  same event is a no-op, so a mail client that prefetches then a human that clicks produce
 *  one state, not two. In-app legs are copied through untouched (§10.7). */
export function applyUnsubscribeToValue(value: PrefOverrideValue, event: string): PrefOverrideValue | null {
  if (event === "all") {
    if (value.allEmailsOff === true) return value; // already off — no write
    return { ...value, allEmailsOff: true };
  }
  if (!isEventKey(event)) return null; // unknown-but-well-formed key: generic success, no write
  const current = value.events?.[event];
  if (current?.email === false) return value; // already off — no write
  return { ...value, events: { ...value.events, [event]: { ...current, email: false } } };
}

/**
 * Verify a token and apply the unsubscribe. Returns nothing in EVERY case — valid, invalid,
 * malformed, unknown event — so no caller can build a response that distinguishes them.
 *
 * A USER row gates that seat's emails; a PARTNER row gates that org's `partners.email` sends.
 * Which one a token addresses is a property of the row, so nothing about the subject is taken
 * from the request.
 */
export async function applyUnsubscribe(db: DB, input: UnsubscribeRequest): Promise<void> {
  const { tokenId, secret } = splitToken(input.token);
  const [row] = tokenId
    ? await db
        .select({ id: overrides.id, tenantId: overrides.tenantId, tokenSecret: overrides.tokenSecret, value: overrides.value })
        .from(overrides)
        .where(eq(overrides.tokenId, tokenId))
    : [];

  // AUT-09 + AUT-05: ALWAYS compare, even with no row, against an equal-length constant. The
  // `row` test is deliberately the SECOND operand so the comparison is never short-circuited
  // away — that ordering is the whole point of the dummy.
  const secretOk = timingSafeEqualStr(secret, row?.tokenSecret ?? DUMMY_SECRET);
  if (!secretOk || !row) return;

  const value = parseOverrideValue(row.value) ?? {};
  const next = applyUnsubscribeToValue(value, input.event);
  if (next === null || next === value) return; // unknown key, or already applied

  // PRN-08: the update carries the row's OWN tenant alongside its id. The id came from a
  // globally-unique token lookup, so the tenant pin is redundant by construction — it is here
  // so this write looks like every other write in the codebase and cannot become the one
  // un-pinned statement a later edit widens.
  await db
    .update(overrides)
    .set({ value: next, updatedAt: sql`now()` })
    .where(and(eq(overrides.id, row.id), eq(overrides.tenantId, row.tenantId)));
}
