# ADR-0028: Partner reference prefix becomes PR-### (was JV-###)

Status: Accepted (owner decision, 2026-07-15 — testing round 1, note #7)
Amends: ADR-0019 (ref-ID v2), whose "Partners: `JV-###` unchanged" line this supersedes.

## Context

During live testing the owner ruled that partner reference IDs should read `PR-###`
("partner"), not `JV-###` — and chose the full rename: display, generation, exports,
emails, seeds, and existing data (not display-only, not new-partners-only).

## Decision

- `formatPartnerRef` emits `PR-###`. Migration `0022_partner_ref_prefix_pr.sql`
  renames existing rows 1:1 (`JV-00X → PR-00X`, same numbers) — safe under the
  `(tenant_id, ref_id)` unique index; ordering unchanged.
- `nextPartnerNumber` accepts BOTH prefixes (`/^(?:PR|JV)-(\d+)$/`). ADR-0019
  rejected dual-format tolerance as unneeded then; here it is deliberate deploy-skew
  insurance — an environment running new code before migration 0022 must keep
  advancing the sequence past surviving JV- rows so it can never mint a colliding
  number (pinned by PARTNERS-REF-04 + the partners.test.ts mixed-prefix case).
- The AI answer renderer's ref matcher accepts `PR-` and keeps `JV-` so historical
  text (e.g. quoted activity entries) still renders as mono refs.

## Consequences

- `audit_log.entity_ref` history keeps `JV-…` — the log is append-only (F-05);
  it is evidence of what was true at the time and is never rewritten.
- The Excel export column header "JV Partner Name" is UNCHANGED — that header is
  part of the fixed export contract mirroring the owner's original workbook, where
  "JV" is the business term (joint-venture partner), not the ref prefix. Renaming
  it is a separate owner decision if ever wanted.
- SPEC DM-07 updated to `PR-###` (and synced to the ADR-0019 lead/import formats,
  which the row had never picked up).
