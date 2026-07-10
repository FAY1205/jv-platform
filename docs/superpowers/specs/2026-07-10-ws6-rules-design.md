# WS-6 — Rules (redesign) · design

**Program:** REDESIGN-R3 §4 WS-6 · **Branch:** ws-6/rules (off phase-2/distribution)
**Spec:** MLS-01..05, PRN-04, PRN-07, DM-08, CVG-02, SET-12 · **Date:** 2026-07-10

## Goal
Redesign `/rules` around **MLS filter patterns only**. The old "unified Rules area"
(CVG-02) is decomposed by R3: recodes removed (WS-1/ADR-0018), coverage owned by
Partners (WS-5), Source Profiles' true home is Settings (SET-12 → WS-7).

## Locked decisions
1. **Remove the Coverage card** from `/rules` (coverage is edited/read on Partners,
   WS-5). Delete the now-dead `coverageSummary` query + `CoverageSummary` type from
   `modules/rules/queries.ts` (used ONLY by the Rules route — verified) and drop
   `coverage` from the `/api/admin/rules` GET payload. No other caller.
2. **Keep the File formats (Source Profiles) card** on `/rules` for now
   (owner-confirmed). SET-12's real home is Settings → Data & Export; **WS-7 relocates
   it**. Removing it now would orphan template downloads until WS-7. Tracked below.
3. **MLS section rebuilt** (the WS-6 substance):
   - Raw `<input type=checkbox accent-brand>` → the WS-1 **`Checkbox`** primitive (F-62).
   - **Match-type grouping**: two groups with headers + a one-line precedence
     explanation. **Keep-override group first** (it beats disqualify — MLS-02, the
     engine checks overrides before disqualifiers), disqualify group second.
   - **Pattern-key** shown per row (the stable id, e.g. `dq_is_listed_yes`); the regex
     stays visible but read-only (PRN-04 — never editable at runtime).
   - Plain-language label is the primary text; the per-row Effect badge is dropped
     (the group header now conveys effect — DRY, PRN-14 keeps text labels not color).
4. **PRN-04 / DM-08 unchanged**: toggle writes `enabled` (+ label) only, never regex;
   every edit audited; the run snapshots live rules. No engine/schema change.

## Delta (files)
- `src/lib/mls-groups.ts` (new, pure) — `groupMlsPatterns(patterns)` → ordered groups
  (keep-override first), each `{ effect, title, hint, patterns }`. Encodes precedence.
- `src/app/rules/page.tsx` — rebuild MLS card on `Checkbox` + grouped rendering; drop
  Coverage card + `Coverage`/`coverage` from `RulesData`; keep File formats card.
- `src/app/api/admin/rules/route.ts` — GET returns `{ mlsPatterns, formats }`.
- `src/modules/rules/queries.ts` — remove `coverageSummary` + `CoverageSummary`.
- Comments referencing recodes reconciled where touched.

## Tests
- `tests/unit/mls-groups.test.ts` (new) — grouping partitions by type, keep-override
  group ordered first, patterns preserved (MLS-02 precedence, CVG-02).
- `tests/integration/rules.test.ts` — keep the MLS toggle test (CVG-02/PRN-04); remove
  the coverage-summary test (query deleted).

## Acceptance
- MLS toggle test green; grouping unit test green; typecheck + lint + unit green;
  integration self-skips clean (no local DB). `/api/admin/rules` no longer returns
  `coverage`. Page renders MLS (grouped, Checkbox) + File formats only.

## Deferred / follow-ups (tracked)
- **WS-7:** relocate File formats (Source Profiles) card to Settings → Data & Export
  (SET-12); then `/rules` is truly MLS-only.
- SPEC CVG-02 (line 354) still lists "campaign recodes" + "unified Rules area" — stale
  vs ADR-0018 and the R3 decomposition. Doc reconciliation left to the owner (not
  editing the contract spec inside a page WP).
