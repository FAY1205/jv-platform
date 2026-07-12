# WP-GL-B — Retention sweep: PII purge of soft-deleted leads

_Phase A / Go-Live code item B. Tier A (touches consumer PII + a `leads` migration)._

> **REVISED (owner decision 2026-07-13):** purge is **immediate, in the void transaction**
> (grace → 0), not a delayed grace-window sweep — a void is a "wrong file, re-import" undo, so the
> PII goes at once. The scheduled sweep is now a **backstop** for any stray soft-deleted-unpurged
> lead. Street `address` (+ the `dedupe_key` that embeds it) is also redacted. The authoritative
> record is **ADR-0025**; sections below marked _(superseded)_ describe the original grace-window
> design.

## Problem

When an import is voided (WP-J2), its leads are **soft-deleted** (`leads.deleted_at` set) —
excluded from dedupe/analytics/exports everywhere, but the rows persist. Their **seller PII**
(`seller_first/last`, `phone`, `phone_norm`, `email`, and the full source row in `raw_json`)
therefore **persists forever**. There is no retention/purge path today. Real seller PII will
start flowing at launch, so this is a go-live gap.

## Spec basis

- **DM-09** — "Soft-delete with restore for partners and leads; **hard delete only via
  retention policy** or account deletion." → the retention policy is the sanctioned path to
  remove a soft-deleted lead's data.
- **LGL-02** — CCPA/CPRA-shaped data rights: "deletion **with grace period**."
- **SEC-05** — seller phone/email are consumer PII (excluded from logs, masked in AI traces).
- **Architecture (§4)** — "Job routes: listing checks, digests, **retention sweeps** —
  idempotent, retried with backoff." → a scheduled cron, like the outbox drain.
- **SET-07** — retention default for original upload files is 365 days (a related but
  separate setting; this WP is about soft-deleted lead PII, not upload files).

## Decision: redact (anonymize), not hard-delete — for V1

DM-09 permits hard-delete, but **redaction is the safer, spec-satisfying V1**:

- `lead_notes`, `lead_status_history`, `listing_checks`, and `audit_log` all reference
  `leads.id`. Hard-delete needs cascade handling and would erase audit/history.
- Redaction **keeps the immutable audit trail (DM-04), the `LD-` ref-id (DM-07), and the
  analytics history counts** while **fully removing the consumer PII** (SEC-05/LGL-02 intent).
- No FK cascade, no schema-destructive risk — just column UPDATEs.

Hard-delete remains available as a stricter escalation if the owner wants it (flagged below).

## Scope

**Which leads:** `deleted_at IS NOT NULL AND deleted_at < (now − grace) AND pii_purged_at IS NULL`,
tenant-scoped. Live leads (`deleted_at IS NULL`) are never touched — DM-02 keeps `raw_json`
forever for reprocessing/disputes on live leads.

**Redacted → null:** `seller_first`, `seller_last`, `phone`, `phone_norm`, `email`,
`reason_for_selling`, `motivation`, `time_to_sell`, `notes`.
**Redacted → sentinel:** `raw_json = {"_redacted": true}` (column is `NOT NULL`).
**Kept:** `ref_id`, `dedupe_key`, `upload_id`, property location (`address*`, `city`, `state`,
`zip`), all decision columns, `deleted_at`. _Property address is retained for coverage-gap
analytics; redacting it too is an owner option (flagged)._

**Grace window:** `RETENTION_GRACE_DAYS = 30` (a named constant; a fixed safety delay before
irreversible PII loss — time to notice/escalate a mistaken void. There is no un-void/restore
action yet, so the window is a delay, not the backing for a restore feature). Flagged as an
owner policy value — can later become a per-tenant setting.

**Note bodies (added after review, audit-data/compliance F-1):** the sweep also redacts
`lead_notes.body → "[redacted — retention sweep]"` for the purged leads (in the same
transaction), because a free-text note is the likeliest place a human typed the seller's
contact info. Both note streams are redacted (PRN-13 is a visibility boundary; this is a
system anonymization with no viewer). Each lead's audit row records `notesRedacted: <count>`.

## Mechanism

- **Pure** `src/modules/retention/purge.ts` (client-safe, no DB): `RETENTION_GRACE_DAYS/MS`,
  `retentionCutoff(now, graceMs)`, `isPastRetention(deletedAt, now, graceMs)`,
  `redactionPatch()` (the column values to write), `REDACTED_RAW_JSON`. TDD target.
- **Adapter** `src/modules/retention/sweep.ts` (imports `@/db`): `sweepTenantPii(db, {tenantId,
  now?, graceMs?, limit?})` — one transaction: select an eligible batch (bounded `limit`,
  default 500) → UPDATE redaction patch + `pii_purged_at = now` → one append-only `audit_log`
  row per lead (`action: "lead.pii_purged"`, `entityType: "lead"`, `entityRef: refId`,
  `before/after` carry **no PII** — just `{piiPurged:false}`/`{piiPurged:true}`,
  `actorUserId: null` = system, `traceId`). Idempotent via `pii_purged_at`. Mirrors
  `drainOutbox`'s tenant-scoped/bounded shape.
- **Cron** `src/app/api/cron/retention-sweep/route.ts` — `isAuthorizedCron` (CRON_SECRET,
  already built) → list tenant ids → `sweepTenantPii` per tenant (best-effort per tenant, like
  drain-outbox) → `{code:"ok", tenants, purged}`. `maxDuration = 60`.
- **`vercel.json`** — add a **daily** cron `/api/cron/retention-sweep` (`0 3 * * *`); a PII
  purge does not need 5-minute frequency.
- **Migration 0019** — add `leads.pii_purged_at timestamptz` (nullable) + partial index
  `leads (tenant_id, deleted_at) WHERE pii_purged_at IS NULL AND deleted_at IS NOT NULL`
  (indexes only the small soft-deleted-not-yet-purged set the sweep scans). RLS: N/A —
  inherits the `leads` row policies (column-level RLS isn't used). Seed: N/A (runtime marker).

## Tenancy / safety

- Every select/update/insert filters `tenant_id` (PRN-08); the cron's only cross-tenant read is
  the tenant-id list (a system operation, exactly like `drain-outbox`).
- Best-effort per tenant: one tenant's failure can't stop the others.
- Redaction is irreversible by design; it only ever touches leads soft-deleted for ≥ grace.

## Decisions (resolved by owner 2026-07-13 → ADR-0025)

1. **Grace window** — **0 / immediate.** Purge in the void transaction; no delay (re-import is the
   recovery path, and there is no un-void).
2. **Redact vs hard-delete** — **redact** (keeps audit trail / ref-id / history).
3. **Property address** — **redact it too** (+ sentinel `dedupe_key`); keep only `city`/`state`/`zip`.

## Tests

- **Unit (TDD)** — `tests/unit/retention-purge.test.ts`: `isPastRetention` (null→false;
  in-window→false; past-window & boundary→true), `retentionCutoff`, `redactionPatch` nulls the
  PII set + sets the `raw_json` sentinel. Names cite **DM-09 / LGL-02**.
- **Integration** — `tests/integration/retention.test.ts` (self-skips w/o DATABASE_URL):
  backdated soft-deleted lead → sweep redacts PII + sets `pii_purged_at` + writes audit; live
  lead untouched; within-window soft-deleted lead untouched; second run purges 0 (idempotent).
