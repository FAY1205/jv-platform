# ADR-0018: Remove campaign recodes entirely

- **Status:** Accepted (REDESIGN-R3 decision D3)
- **Date:** 2026-07-09
- **Phase / WP:** Phase 2 · REDESIGN-R3 WS-1

## Context

The pipeline carried a "campaign recode" step: a tenant-managed `campaign_recodes` table
mapping raw campaign strings to short codes (e.g. `Lead Zolo*` → `Z`), applied as
`campaignCode = recode(campaign, recodes)` and surfaced in the delivered Excel "Campaign"
column. In owner review the feature was judged unnecessary complexity — the as-imported
campaign value is what partners want to see — and it adds a rules surface, API routes,
and a snapshot dimension that must be versioned and tested. The audit also noted the
recode engine's ordering was unpinned (TR-3); removing recodes eliminates that concern
for recodes entirely (MLS ordering is pinned separately in WS-0).

## Decision

Remove campaign recodes **entirely**: the `pipeline/recode.ts` step, the `campaignCode`
field, the `campaign_recodes` table (+ its RLS policy), the rules-area UI section, the
recode API routes, the seed data, and all recode tests. The as-imported `leads.campaign`
column becomes the sole campaign value everywhere it was previously recoded (the export
"Campaign" column, run/portal queries).

Because the rules snapshot no longer includes `recodes`, the `rulesHash` changes; and
because the exported Campaign column now shows the raw value, the golden fixture's
`campaign` outcomes change. This is a genuine output change and is re-pinned **once** in
WS-1 — the single semantic golden re-pin of the R3 program (the WS-0 golden change was
additive-only). Migration `0011_drop_campaign_recodes.sql` drops the table forward-only;
no production data exists.

Alternatives considered: **keep the table, hide the UI** — rejected: leaves dead schema,
snapshot dimension, and code paths to maintain and audit. **Make recodes optional per
tenant** — rejected: same complexity the owner asked to remove.

## Consequences

- Simpler pipeline and snapshot; one fewer rules surface to version, test, and audit.
- One deliberate golden re-pin (recorded in the commit); `DM-08` honored (rules change ⇒
  new golden). Past runs already stored their own snapshot, so historical
  reproducibility is unaffected.
- The export contract's Campaign column now carries the raw campaign string — acceptable
  pre-production (the export format itself is unchanged in shape).
