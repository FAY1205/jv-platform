# WS-8 — Coverage + Activity + shell polish + portal quick-fixes · design

**Program:** REDESIGN-R3 §4 WS-8 · **Branch:** ws-8/polish (off phase-2/distribution @ 2173509)
**Spec:** ACT-01/04, CVG, DSN-07/10, SCP-04, PTL-*, PRN-08/12/14 · **Date:** 2026-07-10

Exploration note: one Explore pass accidentally read the stale `668d2f0` tree; corrected by
direct reads of the real base (2173509). Confirmed present: `src/app/coverage/page.tsx`,
`src/app/activity/page.tsx`, `CoverageMap` + `CountyCoverageMap`, `Pagination`,
`DateRangePicker`, `src/lib/tokens/tokens.ts`.

## Slices
### 8a — AppShell + Table a11y polish
- **F-85** (quick, high-value): `Th` doesn't set `scope="col"`. Add `scope="col"` default in
  `src/components/Table.tsx` (callers can still override via `...rest`).
- **F-70**: the AppShell mobile drawer has no Escape-to-close, no focus move-in, no focus
  return, no `role="dialog"`/`aria-modal`. Add Esc handler (while `mobileOpen`), `role="dialog"`
  + `aria-modal`, focus the drawer on open, return focus to the menu toggle on close, and make
  the rest of the app `inert` while open so Tab is trapped in the drawer (pr-review F-3). The
  interaction test (Escape/focus) is left to the portal E2E (TST-07) — a full-AppShell RTL
  render (matchMedia + next router + bell/profile queries) is disproportionate; `Th scope` is
  unit-tested.
- **F-63 — DEFERRED (decision)**: AppShell uses deliberate 10/11/5px radii + 17/18px icons that
  don't map to the 8/12/16 radius token scale. Tokenizing 1:1 adds noise; snapping to the scale
  shifts the visual design the owner already signed off. Left for an owner design call, not
  churned inside a polish WP. (Recorded here per the "flag, don't guess" rule.)

### 8b — Coverage (F-19, F-69)
- **F-19**: map state labels are hardcoded `#fff` + a dark halo. Add a pure luminance helper
  `contrastText(hex)` → black/white (WCAG relative luminance) in `src/lib/contrast.ts`, unit-test
  it, and use it for the label fill in `CoverageMap` + `CountyCoverageMap` (halo kept as a belt).
- **F-69 — satisfied via companion list**: the Coverage page already renders a keyboard-operable
  "Partners" companion list (aside, `aria-pressed` buttons) that provides the same select action
  as the map — the spec's sanctioned alternative to map-keyboard. Made the pattern explicit in
  the map's visible helper caption. (No 50-hex tab trap; no cross-component `aria-describedby`
  wiring into CountyCoverageMap — the visible caption + the existing keyboard list are the
  delivered pattern.)

### 8c — Activity (ACT-01 filterable audit surface)
- Server-side filtering replaces the current client-only "Security only" checkbox: extend
  `listAdminActivity` + `/api/activity` with Zod-parsed params — `category` (all/security/data),
  `actor` (user id/email), `dateFrom`/`dateTo`, `q` (action/entityRef search), and `dir`
  (When asc/desc). Pure query-param schema unit-tested; SQL filters covered by integration.
- Page: filter bar on `Select` (category, actor) + `DateRangePicker` + debounced search `Input`;
  a sortable "When" column (`Th` sortable); `Pagination` component (replaces hand-rolled Prev/Next).

### 8d — Portal quick-fixes
- **F-66**: `Button` sizes cap at 36px (`md`). Add a `lg` size (`min-h-11`, 44px) and apply it to
  the key portal touch targets (export, pagination, per-device sign-out, status control) — SCP-04
  / DSN-10 ≥44px on the 375px portal.
- **F-22**: `portal/leads/page.tsx` (silent empty on error) + `portal/leads/[ref]/page.tsx`
  (permanent skeleton on error) don't handle the query `error`. Add honest error branches
  (mirror `portal/activity` which already does).
- **F-20 facet**: `portal/devices` revoke mutation has no `onError` — surface an inline error
  (no ToastProvider in the portal tree; use inline text, not a toast).

## Acceptance
Per slice: tsc + lint clean; new logic TDD'd with requirement IDs; DB tests self-skip. pr-reviewer
+ §6 self-audit before the single WS-8 merge. Browser walkthrough at end-of-program (owner).

## Deferred (tracked)
- F-63 radii/icon tokenization (owner design call). Full PortalShell chrome (F-25, already R3-deferred).
- Activity actor filter uses a distinct-actor list from the current tenant's audit rows (bounded).
