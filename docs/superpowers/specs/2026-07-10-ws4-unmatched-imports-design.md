# WS-4 — Unmatched + Imports — execution design

**Program:** REDESIGN-R3 · **Branch:** phase-2/distribution · **Baseline:** WS-3 head
**Authority:** `docs/backlog/REDESIGN-R3.md` §4 WS-4. No locked decision reopened.

Covers two pages: the **Unmatched** inbox and the **Import detail** (`/imports/[ref]`).
Reuses WS-3 primitives + the paginated leads list heavily (touch-once, DRY).

## Locked inputs / bounds
- Consume WS-1/WS-3 primitives: `Table`/`Th`/`Tr`/`Td`, `Pagination`, `RowOpenButton`,
  `Dialog`, Radix `Select`, `Input`, `Textarea`, code-split `LeadDialog`, `CoverageMap`
  (state-level). No raw select/input/textarea/`Modal`/`NativeSelect`/`CountyCoverageMap`
  on either reworked page.
- Invariants: PRN-08 scope guard, PRN-12 tokens-only, PRN-14 partner name+ref+color,
  PRN-15 (no re-derived statistics), PRN-05 (assignment is additive; original snapshot kept).
- F-55 (deferred from WS-3): the unmatched + import-detail ref-id deep-links open
  `LeadDialog`, not the old `/leads/[ref]` page.

## A. Unmatched — backend (F-11: kill the unbounded fetch)
The current `/api/leads/unmatched` returns ALL gap leads grouped by state, unbounded
(`listUnmatched`). Retire it:
- **Delete** `src/modules/leads/unmatched.ts` (+`tests/unit/unmatched-grouping.test.ts`),
  `listUnmatched` from `queries.ts`, and the `UnmatchedGroup`/`UnmatchedLead` imports.
  Keep `unmatchedWhere` + `unmatchedCount` (nav badge).
- **Add** `unmatchedStateStats(scope): Promise<{ total: number; byState: { state: string;
  count: number }[] }>` in `queries.ts` — a bounded SQL aggregate:
  `select coalesce(nullif(trim(state),''),'—') as state, count(*)::int from leads where
  <unmatchedWhere> group by 1 order by count desc`. `total` = Σ counts.
- **Repurpose** `/api/leads/unmatched` GET → returns `unmatchedStateStats` (stats + map data).
- The **table** uses the EXISTING paginated `/api/leads?partnerId=unmatched&page=&pageSize=`
  (WS-3 `listLeads` already supports the `unmatched` sentinel + pagination) — this is what
  actually closes F-11.

## B. Unmatched — UI (`src/app/unmatched/page.tsx` rewrite)
- **Stats row:** total unmatched + per-state count chips (from `unmatchedStateStats`).
- **Map:** state-level `CoverageMap` lighting gap states (built from `byState`, reusing the
  existing `StateCoverage[]` gap-state shape). Removes `CountyCoverageMap` + its ~0.9 MB
  county-geometry fetch (F-56 facet).
- **Table:** a focused `UnmatchedTable` on the `Table` primitive — columns Lead · Seller ·
  Property · Received · (Assign action). Data from `/api/leads?partnerId=unmatched` with
  `Pagination` (rows-per-page {10,20,50}, default 20). Ref-id → `RowOpenButton` opening the
  code-split `LeadDialog` (F-55). Assign button per row opens `AssignModal`.
- **`AssignModal`:** on `Dialog`; **id-only state** — the page holds `assigningRef: string |
  null` (F-80), not the lead object. Partner picker → Radix `Select`; reason → `Input`.
  Keeps the "recorded in activity; original unmatched record kept (PRN-05)" note. On success,
  invalidate `["leads"]`, `["unmatched"]`, `["coverage"]`, `["dashboard"]`.
- States: loading / error / empty (full coverage) / success all present.

## C. Import detail (`/imports/[ref]`) rework
- **F-75:** the "Distributed" headline stat reads the server-sourced value
  `distribution.reduce((s,d) => s + d.count, 0)` (RunDetail.distribution is server-computed),
  not the client-derived `delivered.filter(...).length`. The `delivered` array may still drive
  the per-partner "Distributed leads" table grouping (that is display of the leads, not a
  re-derived statistic).
- **F-65:** the void `Dialog` (was `Modal`) **names the run** in its title/body (`upload.refId`
  + filename) and **explains the reason rule** — a hint that a reason of at least 3 characters
  is required, shown by the disabled submit. Raw `<textarea>` → `Textarea` (with the same
  min-length behavior + inline error on failure).
- **Modal → Dialog** for the void confirm.
- **F-55:** `GroupRows`' `<Link href={`/leads/${refId}`}>` → `RowOpenButton` opening the
  code-split `LeadDialog`; the page manages `openRef` state + renders `<LeadDialog>`.
- IDs already render `IM-26-###` (WS-1 migration) — no change.

## D. Out of scope / deferred (WP candidates)
- The routing-**composition** breakdown still uses a client `buildAnalytics` call
  (`imports/[ref]/page.tsx`). It is computed once from the run's own leads (not a diverging
  statistic), so it stays; noted as a PRN-15 candidate for a future server-sourced sweep. NOT
  one of WS-4's named findings.
- `Modal`/`NativeSelect`/`CountyCoverageMap` global deletion (end of WS-8, as their last call
  sites retire).
- The `/leads/[ref]` old read-only page (removed after WS-5, once partners also switches).

## E. Testing
- *Integration* (`tests/integration/unmatched-stats.test.ts`): seed unmatched + matched leads
  across states; assert `unmatchedStateStats` counts only currently-unmatched leads
  (kept, no pipeline partner, no manual partner), grouped by state, total correct, and a
  manually-assigned lead is excluded (PRN-05 / ASN-03). Requirement-ID named.
- The retired `unmatched-grouping.test.ts` is deleted with its module.
- UI (both pages) verified by `typecheck`/`lint` + the owner walkthrough (browser preview is
  admin-auth-gated + concurrent-dev-server-constrained, as in WS-2/WS-3).

## F. Commit sequence
1. Backend: retire `listUnmatched`/`unmatched.ts`; add `unmatchedStateStats` + repurpose the
   route; integration test.
2. Unmatched UI rewrite (stats + `CoverageMap` + paginated `UnmatchedTable` + `AssignModal` on
   Dialog, id-only + `LeadDialog`).
3. Import detail: F-75 stat + F-65 void Dialog + Textarea + `LeadDialog` deep-link.

## Acceptance (WS-4 gate)
- No unbounded unmatched fetch (F-11): stats via a bounded aggregate; the table is
  server-paginated via the reused leads endpoint.
- Unmatched map is state-level (no county geometry); assign modal is id-only (F-80) on Dialog;
  no raw select/input/Modal on either page.
- Import "Distributed" stat is server-sourced (F-75); void modal names the run + explains the
  reason rule (F-65).
- Both pages' ref-id deep-links open `LeadDialog` (F-55).
- `pnpm test:unit` + `pnpm test:integration` (sequential) green; `typecheck`/`lint` clean.
