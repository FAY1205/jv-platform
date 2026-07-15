// ─────────────────────────────────────────────────────────────────────────────
// Audit-trail PII redaction (SEC-05, LGL-02, DM-04). audit_log is append-only
// compliance evidence (migration 0014): it records WHO changed WHAT and WHEN, never
// the consumer's raw values. Seller PII must never be written into before/after — it
// would sit permanently in a table the retention sweep (WP-GL-B) can't reach,
// breaking "seller PII is fully purged after retention" and putting seller
// phone/email in a log (SEC-05, "excluded from logs").
//
// Instead we store a presence-preserving MASK: a changed PII field reads REDACTED
// when it held a value and null when empty, so an auditor still sees added vs cleared
// vs changed — just never the value. PURE (PRN-01-friendly): no I/O, same input ⇒
// same output. See ADR-0031.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lead columns treated as consumer PII in the audit trail (SEC-05). Their values are
 * masked out of audit before/after.
 *
 * COARSE location (`city`/`state`/`zip`) and `campaign` are deliberately NOT here:
 * they are not personally identifying, they drive routing, so their old→new IS the
 * audit-relevant part of an edit (DM-04) — and the retention sweep keeps them on the
 * lead for exactly that reason.
 *
 * The STREET `address` IS here, despite being a property field. The retention sweep
 * (src/modules/retention/purge.ts, redactionPatch) nulls it and keeps only the coarse
 * location, calling city/state/zip "not personally identifying" — which makes the
 * street address precisely what is. It is editable (EDITABLE_COLUMNS), so it reached
 * before/after; unmasked, editing then voiding a lead left the street address in the
 * append-only trail forever, which is the exact leak this module exists to stop.
 * Routing legibility survives without it: assignment keys off zip5 + state, both raw.
 *
 * CONTRACT (ADR-0031): the retention sweep redacts these same lead columns on the
 * `leads` table. Keep the two sets in lockstep — a column that is purge-worthy on
 * `leads` must be mask-worthy here, or PII re-enters the permanent trail. That
 * contract was stated but never enforced, and `address` had already broken it; the
 * lockstep is now pinned by tests/unit/audit-redact.test.ts.
 */
export const AUDIT_PII_LEAD_FIELDS: ReadonlySet<string> = new Set([
  "sellerFirst",
  "sellerLast",
  "phone",
  "email",
  "reasonForSelling",
  "motivation",
  "timeToSell",
  "notes",
  "address",
]);

/** The sentinel written in place of a present PII value. Carries no input data. */
export const REDACTED = "[redacted]" as const;

/**
 * Presence-preserving mask for one PII value: null / undefined / "" → null (so a
 * "cleared" edit stays legible in the before/after diff), any other value → REDACTED.
 * Never returns the value itself.
 */
export function maskAuditValue(value: unknown): typeof REDACTED | null {
  return value === null || value === undefined || value === "" ? null : REDACTED;
}

/** True if `field` is a lead column whose audit value must be masked (allow-list). */
export function isAuditPiiLeadField(field: string): boolean {
  return AUDIT_PII_LEAD_FIELDS.has(field);
}
