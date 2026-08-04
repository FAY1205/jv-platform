# WP-I — Drop the admin per-lead matchcard map (state-vs-ZIP resolution)

**Status:** design · **Branch:** phase-2/distribution · **Date:** 2026-07-12
**Inputs:** owner ⭐ decision F-1 (menu) · current code: `src/app/leads/lead-territory.tsx`,
`src/app/leads/lead-dialog.tsx`
**Owner call (2026-07-12):** drop the admin per-lead territory **map** from the lead-dialog
matchcard; keep the `routingExplanation` sentence.

---

## 1. Problem

The admin lead dialog's matchcard (`LeadTerritory`) highlights the matched partner's territory on
`CountyCoverageMap`, which colors counties by their **state-level** owner. A ZIP-matched lead's
partner may own the specific ZIP (a `zipRules` override) while a *different* partner owns the state —
so the highlight can land on a region that isn't where the lead is. Today's stopgap is an honesty
caveat line for `matchMethod === "zip"`. The portal already dropped its per-lead map (WP-F.3); the
owner chose the same for admin — which **eliminates the state-vs-ZIP mismatch entirely** rather than
papering over it.

## 2. Change

- **Delete** `src/app/leads/lead-territory.tsx` (the only consumer is the lead dialog; grep-verified).
  `CountyCoverageMap` stays — `/coverage` and the partner profile still use it.
- **`src/app/leads/lead-dialog.tsx`:** replace the `<LeadTerritory .../>` block (the map section) with
  an inline plain-language routing sentence built from the existing pure `routingExplanation`
  (`@/lib/match-method`, F-57, already unit-tested in `match-method.test.ts`). Add `routingExplanation`
  to the existing `@/lib/match-method` import; drop the `./lead-territory` import.
- The **zip caveat is removed** — it only existed to explain the state-level map, which is now gone.

No new logic (the sentence helper is unchanged and already tested), no backend, no query, no schema,
no token. Pure UI simplification.

## 3. Non-negotiables

- **PRN-14** unaffected: the partner is still shown as `PartnerTag` (color + name + `JV-###`) in the
  dialog header, immediately above the routing sentence.
- **PRN-12 / DSN-03:** the sentence uses semantic tokens (`text-text-2`); no new component states.

## 4. Verification

- `pnpm exec vitest run tests/unit/match-method.test.ts --no-file-parallelism` green (helper
  unchanged); full unit suite green; `pnpm typecheck`; eslint the changed file.
- Review: **pr-reviewer** (a pure removal/inline — no scoped query, API, token, or interactive
  surface, so tenancy/design-system/a11y specialists are not warranted).
- Owner walkthrough: show the dialog matchcard region now reads as the routing sentence (no map).

## 5. Out of scope

- The `routingExplanation` copy itself (unchanged).
- WP-F.2 (void recall) — separate WP.
