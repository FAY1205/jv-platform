# WP-GL-C — Audit-log PII redaction (design)

- **Date:** 2026-07-13
- **Tier:** A (compliance-critical; touches PII + the audit trail)
- **Requirements:** SEC-05, LGL-02, DM-04 · **ADR:** [0021](../../adr/0021-audit-log-no-consumer-pii.md)

## Problem

`editLead` (`lead.edited`) and `editLeadNote` (`note.edited`) write the **raw**
before/after values of seller PII into `audit_log.before` / `.after`. That table is
append-only (migration 0014), so a lead edited before being voided keeps its seller
PII permanently in a place the WP-GL-B retention sweep cannot reach. Result: "seller
PII is fully purged after retention" is false, and seller phone/email live in a log
against SEC-05.

## Decision (approved)

Redact consumer PII **at write time** — it never enters `audit_log`. Rejected the
retention-sweep-purge alternative: it keeps raw PII in the log for the whole
retention window and hands app code a privileged mutation capability over the
compliance table. Full rationale in ADR-0021.

## Design

### Shared classifier — `src/modules/audit/redact.ts` (pure)

- `AUDIT_PII_LEAD_FIELDS: Set<string>` — the eight consumer-PII lead columns:
  `sellerFirst, sellerLast, phone, email, reasonForSelling, motivation, timeToSell,
  notes`. Property/routing fields (`address, city, state, zip, campaign`) are
  deliberately **excluded** — they drive routing/dedupe and their old→new values are
  the audit-relevant part of an edit (DM-04).
- `REDACTED = "[redacted]"` — the sentinel written in place of a present PII value.
- `maskAuditValue(v)` — presence-preserving mask: `null`/`undefined`/`""` → `null`
  (so "cleared" stays legible), any other value → `REDACTED`. Never returns the value.
- `isAuditPiiLeadField(field)` — membership test.

### `editLead` — `lead.edited`

In the existing changed-column loop, when a column changes: for a PII field, write
`before[col] = maskAuditValue(old)` / `after[col] = maskAuditValue(new)`; for a
non-PII field, keep the raw values (unchanged). The `leads` **row** still stores the
real value via `patch` — only the audit payload is masked. The `partnerAudit`
overlay fields (`effectiveOwner`, `partner`) are partner ids/refs, not consumer PII,
and are unchanged.

### `editLeadNote` — `note.edited`

`before: { body: maskAuditValue(note.body) }`, `after: { body: maskAuditValue(body) }`.
The real current body stays on `lead_notes.body` (subject to the sweep).

### Out of scope (flagged as follow-ups)

- Partner B2B contact info in `partner.created/updated/invited` audit payloads.
- The WP-GL-B retention sweep itself (Phase 3). It must import
  `AUDIT_PII_LEAD_FIELDS` so its `leads`-column redaction set stays in lockstep.

## Tests

- **Unit** `tests/unit/audit-redact.test.ts` — `maskAuditValue` hides present values
  / preserves the null distinction; the eight fields classify as PII; routing fields
  do not (SEC-05, DM-04).
- **Integration** `tests/integration/isolation.test.ts` — after an `editLead` that
  changes a PII field and a routing field, the `lead.edited` audit row's before/after
  contain no raw PII (only `"[redacted]"`/`null`) yet keep the raw routing value
  (SEC-05, LGL-02, DM-04).
- **Integration** `tests/integration/notes-visibility.test.ts` — the existing
  `note.edited` assertion is updated: the audit body is redacted, not the raw text;
  the real edited body still lives on `lead_notes` (SEC-05, NTS-02).

## Non-goals / invariants held

No schema change, no migration. The append-only trigger and `app.audit_log_purge`
hatch are untouched; app code still never mutates a written audit row (PRN — audit
immutability, F-05).
