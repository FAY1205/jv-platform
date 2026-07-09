# ADR-0019: Reference-ID format v2 (true migration)

- **Status:** Accepted (REDESIGN-R3 decision D4)
- **Date:** 2026-07-09
- **Phase / WP:** Phase 2 · REDESIGN-R3 WS-1

## Context

Human-readable reference IDs (DM-07) shipped as `LD-YYYY-#####` (leads),
`UP-YYYY-###` (uploads/imports), `JV-###` (partners). In owner review the four-digit
year read as noisy, and "UP" was opaque — the surface is called "Imports". Since no
production data exists, the format can be changed now with a true data migration rather
than carrying a legacy scheme forever.

## Decision

Adopt **ref-ID v2**:

- Leads: `LD-YYYY-##### → LD-YY-#####` (two-digit year), e.g. `LD-2026-00042 → LD-26-00042`.
- Uploads/imports: `UP-YYYY-### → IM-YY-###`, e.g. `UP-2026-011 → IM-26-011`.
- Partners: `JV-### ` unchanged.

Scope of the change:
- `src/db/ref-ids.ts` formatters emit the two-digit year; `formatUploadRef` becomes
  `formatImportRef` with the `IM-` prefix. The `ref_counters` table and its
  `(tenant, entity, year)` allocation are unchanged — only the rendered format changes.
- All `RefSchema` validators become `/^LD-\d{2}-\d{5,}$/` and `/^IM-\d{2}-\d{3,}$/`.
- Migration `0012_ref_id_v2.sql` rewrites stored values in place with `regexp_replace`:
  `uploads.ref_id`, `leads.ref_id`, `audit_log.entity_ref`, and `notifications.deep_link`.
- Demo-derived text (email_outbox bodies embedding refs) is refreshed by re-running the
  demo seeder, which now emits v2 refs.

Alternatives considered: **dual-read (accept both formats)** — rejected: unnecessary
complexity with no prod data; a true migration is cleaner and permanent. **Keep UP-**
— rejected: owner wants the Imports vocabulary reflected in the ref.

## Consequences

- Shorter, clearer references across UI, exports, digests, and deep links.
- One forward-only data migration on synthetic dev data; no rollback needed (no prod).
- Every ref producer/validator/fixture moves in lockstep in WS-1 so nothing emits or
  accepts a v1 ref afterward.
