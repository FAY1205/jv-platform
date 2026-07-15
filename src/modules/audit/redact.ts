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
// same output. See ADR-0021.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lead columns treated as consumer PII in the audit trail (SEC-05). Their values are
 * masked out of audit before/after. Property/routing fields (address, city, state,
 * zip, campaign) are intentionally NOT here: they drive routing + dedupe, so their
 * old→new values are the audit-relevant part of an edit (DM-04).
 *
 * CONTRACT (ADR-0021): the retention sweep (WP-GL-B) redacts these same lead columns
 * on the `leads` table. Keep the two sets in lockstep — a column that is purge-worthy
 * on `leads` must be mask-worthy here, or PII re-enters the permanent trail. The
 * sweep should import this set, never re-list it.
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
