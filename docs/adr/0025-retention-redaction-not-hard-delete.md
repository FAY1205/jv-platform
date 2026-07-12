# ADR-0025: Void redacts a run's seller PII immediately (redaction, not hard-delete)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Phase / WP:** Phase A (Go-Live) / WP-GL-B

## Context

Voiding an import soft-deletes its leads (`leads.deleted_at`), but their seller PII
(`seller_*`, `phone`, `email`, street `address`, the full source row in `raw_json`, and
free-text `lead_notes`) then persists indefinitely. There is no retention/purge path today,
and real seller PII begins flowing at launch.

**DM-09** permits removal: "Soft-delete with restore for partners and leads; **hard delete only
via retention policy** or account deletion." **LGL-02** requires CCPA/CPRA-shaped "deletion with
grace period." **SEC-05** classes seller phone/email as consumer PII. Taken literally, DM-09
points at a row **hard-delete** — but `leads.id` is referenced by `lead_notes`,
`lead_status_history`, `listing_checks`, and (by ref-id) the append-only `audit_log` (DM-04), so
a hard-delete needs FK cascades and would erase the immutable audit trail and history.

**Owner decision (2026-07-13):** purge **immediately on void**, not after a grace window — a void
is a "wrong file, re-import the correct one" undo, and there is no un-void action, so holding the
PII protects no recovery path. Grace window → **0**.

## Decision

Voiding **redacts (anonymizes)** the run's leads' seller PII **in the void transaction**:

- **Timing:** in `voidUpload`'s transaction, immediately after the soft-delete. A scheduled sweep
  (`src/modules/retention/sweep.ts`, daily cron) is a **backstop** that redacts any other
  soft-deleted-but-unpurged lead (default grace 0). `pii_purged_at` is stamped so the two never
  double-purge.
- **Redact → null:** `seller_first/last`, `phone`, `phone_norm`, `email`, `reason_for_selling`,
  `motivation`, `time_to_sell`, `notes`, `address`, `address_normalized`; **`raw_json →
  {"_redacted":true}`**; **`dedupe_key → "[redacted]"`** (NOT NULL, and it embeds the address);
  **`lead_notes.body → "[redacted — retention sweep]"`** for the purged leads.
- **Keep:** `ref_id` (DM-07), coarse location (`city`/`state`/`zip` — not personally
  identifying), and all decision columns. Stamp `pii_purged_at`; the void's `upload.voided` audit
  row records `piiPurged: <count>` and the backstop sweep writes one `lead.pii_purged` row per
  lead — neither carries PII (SEC-05).

**Alternatives considered:**
- *Row hard-delete (DM-09 literal).* Rejected — FK cascade into 3 child tables, erases the DM-04
  audit trail + DM-07 ref-id + history. Kept as a stricter future escalation.
- *Grace window before purge.* Rejected by the owner — no un-void exists; re-import is the
  recovery path, so a delay protects nothing.
- *Keep property `address` / `dedupe_key`.* Rejected — a street address independently identifies a
  person (audit-compliance F-3), and voided leads don't feed analytics, so there is no cost to
  removing it. `dedupe_key` embeds the address, so it is sentineled too; safe because a
  soft-deleted lead is outside the partial unique index and dedupe history.

Anonymization satisfies LGL-02's deletion intent for the consumer PII while preserving the
compliance-relevant audit trail — this deviates from DM-09's literal "hard delete" wording, hence
this ADR.

## Consequences

- **Easier:** a voided lead's PII is gone the instant it's voided; no waiting, no FK/cascade risk;
  audit trail + ref-ids survive so "which lead, purged when" stays provable.
- **Caveat:** immediate + no un-void means recovery is only via re-importing the source file, which
  the app does not store — acceptable because the void window is 10 min, when the admin still has
  the file (owner-accepted).
- **Reopened by:** a stricter posture (true row hard-delete) would supersede this.
- **Follow-up items (deferred WP candidates, not this WP):**
  - A person-level, request-driven deletion/export path for **live** leads (LGL-02 for all users)
    — this WP only covers voided leftovers (audit-compliance F-2).
  - `audit_log` stores full lead/note values verbatim from `lead.edited`/`note.edited` and is
    append-only, so a lead edited before voiding has un-purgeable PII in the audit trail — a real
    limit on any "fully purged" claim; needs its own ticket (audit-data / compliance).
  - A sanctioned `systemTenantWhere(table, tenantId)` scope.ts helper for background jobs
    (audit-tenancy F-1 / proposed PRN-08b).
  - Admin-authored free-text fields `leads.manual_reason` and `uploads.void_reason` are NOT
    redacted (accepted residual, pr-review F-4). They are admin-sourced, not seller-sourced, and
    `void_reason` is part of the void's own audit context; if an admin ever types seller PII into
    one, it survives purge. Fold into the same follow-up as the `audit_log`-verbatim gap above.
