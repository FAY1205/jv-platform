# ADR-0021: The audit trail never stores raw consumer PII

- **Status:** Accepted
- **Date:** 2026-07-13
- **Phase / WP:** Phase 2 — WP-GL-C (audit PII redaction; hardening for the Phase-3 retention sweep)

## Context

`audit_log` is append-only compliance evidence (DM-04), enforced at the database by
the migration-0014 trigger: no `UPDATE`/`DELETE` succeeds except through the
deliberate, session-scoped `app.audit_log_purge` escape hatch, which app code never
sets.

Two writers put the **raw** before/after values of consumer PII into that trail:

- `editLead` (`src/modules/leads/commands.ts`) — `lead.edited` wrote the seller's
  first/last name, phone, email, reason-for-selling, motivation, time-to-sell, and
  the freeform `notes` column.
- `editLeadNote` (`src/modules/notes/notes.ts`) — `note.edited` wrote the full
  before/after note **body**.

Because the trail is append-only, any lead edited before it was voided kept that
seller PII **permanently** in `audit_log`, somewhere the planned WP-GL-B retention
sweep — which redacts `leads` columns and `lead_notes.body` — can never reach. So
the claim "seller PII is fully purged after retention" was false, and seller
phone/email sat in a log in violation of SEC-05 ("excluded from logs").

Every other audit writer was reviewed: `lead.manually_assigned`, `upload.voided`,
`mls_pattern.updated`, `partner.coverage_updated`, `source_profile.saved`,
`partner.session_revoked` carry no consumer PII. `partner.created/updated/invited`
carry **partner** (B2B) contact info — personal data with a different lifecycle
(retained while the partner is a customer), tracked separately, out of scope here.

Options weighed (see the design spec): (a) store which PII fields changed, not the
values; (b) hashes / booleans; (c) keep writing raw PII and have the retention sweep
purge the audit rows later via the escape hatch.

## Decision

**Consumer PII is redacted at write time — it never enters `audit_log`.**

- A shared, pure classifier (`src/modules/audit/redact.ts`) names the lead columns
  treated as consumer PII and provides a **presence-preserving mask**: a changed PII
  value is recorded as the sentinel `"[redacted]"` when it held a value and `null`
  when empty. An auditor still sees *which* PII field changed and whether it was
  added / cleared / changed — never the value.
- `lead.edited` keeps **raw** before/after for **coarse** location + `campaign`
  (`city`, `state`, `zip`): these are not personally identifying and they drive
  routing, so their old→new values are the audit-relevant part of an edit (DM-04).
  PII fields are masked. `note.edited` masks the body.
- The **street `address` is masked**, despite being a property field. An earlier draft
  of this ADR kept it raw alongside the coarse location; that broke this ADR's own
  lockstep rule (below) and was caught when the rule was finally enforced by a test.
  The retention sweep (`src/modules/retention/purge.ts`, `redactionPatch`) nulls the
  street address and keeps only `city`/`state`/`zip`, which it calls "not personally
  identifying" — that makes the street address precisely what is. It is editable, so
  it reached `before`/`after`: unmasked, editing then voiding a lead left the street
  address in the append-only trail permanently — the exact leak this ADR exists to
  prevent. Routing legibility survives without it, since assignment keys off zip5 +
  state, both still raw.
- The append-only invariant is untouched: no schema change, no migration, and app
  code still never mutates a written row. The `app.audit_log_purge` hatch remains
  reserved for test teardown and the future retention sweep.

Rejected — option (c): it leaves raw PII in an append-only table for the entire
retention window (still violating SEC-05 the whole time) and would hand app code a
privileged `UPDATE`/`DELETE` capability over the compliance table. Preventing PII
from ever being written is strictly stronger and simpler.

## Consequences

- SEC-05 is satisfied at the source; LGL-02 (deletion) is trivially satisfied for the
  audit trail — there is nothing trapped to purge.
- **Contract with WP-GL-B:** `AUDIT_PII_LEAD_FIELDS` and the retention sweep's
  lead-column redaction set must stay in lockstep. A lead column that is
  purge-worthy on `leads` must be mask-worthy here, or PII re-enters the permanent
  trail. The sweep should import the shared set, not re-list it.
- The admin activity view (ACT-01) now shows `"[redacted]"` for PII fields of a
  `lead.edited` / `note.edited` entry instead of the raw value; the actual current
  values remain on the `leads` row / `lead_notes.body` (subject to the sweep).
- Pre-existing audit rows: this ships before real partners are onboarded, so no real
  consumer PII exists in any production `audit_log` to backfill. If that ever changes
  before this lands, the escape-hatch purge helper is the tool to redact legacy rows.
- Audit hooks: `audit-compliance` / `audit-data` verify no consumer-PII field name
  appears in an audit `before`/`after` payload; `pr-reviewer` flags any new audit
  writer that emits a PII column without masking.
