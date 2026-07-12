// ─────────────────────────────────────────────────────────────────────────────
// Retention purge — pure policy for redacting a soft-deleted lead's seller PII
// (WP-GL-B; DM-09 hard-delete-via-retention, LGL-02 deletion, SEC-05 PII).
//
// Voiding an import soft-deletes its leads (deleted_at set). Their seller PII is
// redacted IMMEDIATELY, in the void transaction (src/modules/run/void.ts) — a void
// is a "wrong file, re-import the correct one" undo, so the personal info serves no
// purpose afterward and holding it protects no recovery path (there is no un-void).
// A scheduled sweep (src/modules/retention/sweep.ts) is a backstop that redacts any
// soft-deleted-but-unpurged lead. This module is PURE and client-safe (no DB / no
// clock) — `now` is always injected so it is deterministic and unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

/** Grace window (LGL-02). 0 = purge immediately on void — the owner's decision (2026-07-13):
 *  a voided import is corrected by re-importing, so its PII should go at once. A named constant
 *  the backstop sweep honors too; bump it (or make it a per-tenant setting) to reintroduce a delay. */
export const RETENTION_GRACE_DAYS = 0;
export const RETENTION_GRACE_MS = RETENTION_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** The cutoff instant: leads soft-deleted at or before this are eligible for purge. With a
 *  zero grace this is simply `now`, so any soft-deleted lead qualifies. */
export function retentionCutoff(now: Date, graceMs: number = RETENTION_GRACE_MS): Date {
  return new Date(now.getTime() - graceMs);
}

/** True when a soft-deleted lead has sat past the grace window. A live lead (deletedAt
 *  null) is never eligible. Boundary inclusive (exactly `graceMs` old ⇒ eligible); with a
 *  zero grace, every soft-deleted lead is eligible. */
export function isPastRetention(
  deletedAt: Date | null,
  now: Date,
  graceMs: number = RETENTION_GRACE_MS,
): boolean {
  if (deletedAt === null) return false;
  return now.getTime() - deletedAt.getTime() >= graceMs;
}

/** Sentinel written to `raw_json` (a NOT NULL column, so it can't be nulled) once the
 *  full source row is redacted. */
export const REDACTED_RAW_JSON: { _redacted: true } = { _redacted: true };

/** Sentinel written to a purged lead's note bodies. `lead_notes.body` is NOT NULL and is
 *  free text an admin/partner typed — the single most likely place a human pasted seller PII
 *  ("called Jane at 555-…"), so a purge redacts it alongside the lead's own columns. The
 *  value is source-neutral: written by both the immediate void purge and the backstop sweep. */
export const REDACTED_NOTE_BODY = "[redacted — retention policy]";

/** Sentinel for `dedupe_key` (NOT NULL). The key is `normalized(address)+zip5`, so it embeds
 *  the street address — sentinel it so the address is fully removed. Safe: a purged lead is
 *  soft-deleted and thus outside the partial unique index (WHERE deleted_at IS NULL) and out of
 *  dedupe history, so the key is dead data and duplicate sentinels never collide. */
export const REDACTED_DEDUPE_KEY = "[redacted]";

export interface LeadRedactionPatch {
  sellerFirst: null;
  sellerLast: null;
  phone: null;
  phoneNorm: null;
  email: null;
  reasonForSelling: null;
  motivation: null;
  timeToSell: null;
  notes: null;
  address: null;
  addressNormalized: null;
  dedupeKey: string;
  rawJson: { _redacted: true };
}

/** The column values that redact a lead's seller PII: name, contact, seller-provided fields,
 *  free-text notes, the street address (+ the dedupe key that embeds it), and the full source
 *  row. KEPT: coarse location (`city`/`state`/`zip` — not personally identifying), `ref_id`
 *  (DM-07), and all decision columns — so the audit trail (DM-04) and determinism survive while
 *  the consumer PII (SEC-05) is removed. Pure/deterministic; `pii_purged_at` is stamped by the
 *  caller (it needs the clock), not here. */
export function redactionPatch(): LeadRedactionPatch {
  return {
    sellerFirst: null,
    sellerLast: null,
    phone: null,
    phoneNorm: null,
    email: null,
    reasonForSelling: null,
    motivation: null,
    timeToSell: null,
    notes: null,
    address: null,
    addressNormalized: null,
    dedupeKey: REDACTED_DEDUPE_KEY,
    rawJson: REDACTED_RAW_JSON,
  };
}
