# WP-N3B: Systemic primitives — hit targets, scroll hints, clear-filters

Spec: DSN-03 (state completeness), WCAG 2.5.8 (C-52), FEP/§6.17 · Tier B · One PR.
Source: deep-UX audit 2026-08-19 themes T-TARGET / T-SCROLLHINT / T-CLEAR;
candidates C-52 / C-53 / C-54 in `docs/backlog/CANDIDATES.md` (C-64 a+b fold in here).

All sites re-verified against current main (404d47ab) 2026-08-19 by the orchestrator.
Code wins over the audit text; re-verify each site before editing.

## Goal
Fix three systemic gaps ONCE at the primitive: sub-24px pointer targets, silent
horizontal clipping on wide tables, and filtered-to-zero empty states with no way out.

## Definition of done

### C-52 — hit-target pass (N3B-01) — visuals unchanged, layout-neutral
Rule: every pointer target ≥24×24 CSS px (WCAG 2.5.8 AA); ≥44px on coarse pointers
where cheap. Implement as **invisible hit-area expansion that causes NO layout shift**:
the `before:` pseudo-element pattern (`relative before:absolute before:-inset-<n>
before:content-['']`) on the interactive element — never padding/margin that moves
neighbors.

- **Shared `Checkbox`** (`src/components/Checkbox.tsx:64`): 16px box → add a centered
  ≥24px hit area via pseudo-element on the Radix Root (`relative` +
  `before:absolute before:-inset-1.5 …` ≈ 28px). ⚠️ `TasksPanel.tsx:418-440` and
  `MyTasksList.tsx:275` already wrap their Checkbox in a 44px `<label>` hit area —
  the pseudo-element approach is inert inside those wrappers (no double-padding, no
  layout change); verify visually that nothing shifts at those two sites plus
  unmatched header/rows, settings/notifications, signup, portal login, team
  permissions-card, gallery.
- **Dialog close ✕** (`src/components/Dialog.tsx:86-93`): 18px svg → give the Close
  button a real padded hit box (e.g. `-m-2 p-2` which is layout-neutral by
  construction, or the pseudo-element) reaching ≥24px, keep icon size + position
  visually identical (ml-auto alignment must not drift).
- **`FilterPill`** (`src/components/FilterPill.tsx:28-34`): ~22px tall chips on the
  contractual 375 portal surface → pseudo-element vertical expansion to ≥24px always,
  and ≥44px on coarse pointers via a `pointer-coarse:` variant if the Tailwind version
  supports it (check `package.json` / existing usage; if unsupported, a
  `@media (pointer: coarse)` utility in globals.css following an existing pattern, or
  settle at ≥24 + document). Chips sit in a horizontal scroll row — make sure the
  expanded hit areas of adjacent chips don't overlap-steal clicks (inset only
  vertically if horizontal gaps are tight: `before:-inset-y-*` + small/no x).
- **Tag color swatches** (`src/app/(admin)/settings/tags/page.tsx:254-269`): 16px
  `h-4 w-4` buttons in a `gap-1.5` row — expand each hit area to ≥24px WITHOUT
  overlapping neighbors more than the gap allows: increase the row gap to open space
  if needed (tiny visual change is acceptable here, it is a settings table) or use
  `before:-inset-1` (24px) which exactly consumes the 6px gap — pick the cleanest,
  state the choice in the PR.
- **Bell "Mark all read"** (`src/components/NotificationBell.tsx`, the header link
  near the panel title — locate by text): text-xs link → pseudo-element expansion to
  ≥24px tall.
- Test: tokens/primitive-level unit tests are brittle for hit areas; instead add a
  gallery note + assert the class contract where feasible (e.g. Checkbox root carries
  the expansion class). Name any test `N3B-01/C-52: …`.

### C-53 — scrollHint + min-w adoption (N3B-02)
`Table` already ships opt-in `scrollHint` (edge-fade when scrollable; dashboard tables
use it — `dashboard/page.tsx:323,363` with `min-w-[560px]`/`min-w-[420px]`). Adopt:
- Leads table (`src/app/(admin)/leads/leads-view.tsx:492`): `scrollHint` + a sensible
  `min-w` (~`min-w-[760px]` — it has up to 8 columns; pick by eyeballing column
  budget, state reasoning in PR).
- Unmatched (`src/app/(admin)/unmatched/page.tsx:427`): `scrollHint` + min-w (~640px —
  Waiting + Assign are the decision columns that clip today).
- Imports (`src/app/(admin)/imports/page.tsx:93`): `scrollHint` + min-w (~560px — FILE
  starves to "w…" today).
- Portal mobile chip row (`src/app/portal/leads/leads-mobile.tsx:79`): the
  `-mx-4 overflow-x-auto` chip strip gets the same edge-fade affordance. Reuse the
  Table primitive's fade recipe (extract it if it's cleanly liftable — a tiny shared
  `ScrollHint` wrapper in src/components is acceptable; otherwise a local fade div
  matching the exact same tokens/classes). No color-only cue issues: the fade is an
  affordance addition, content remains reachable by scroll.
- The fade must not intercept pointer events (`pointer-events-none`) and must respect
  both themes (the Table primitive's existing recipe already does — reuse, don't
  reinvent, PRN-12).

### C-54 — Clear filters on filtered-to-zero empties (N3B-03)
Copy Activity's exact recipe (`src/app/(admin)/activity/page.tsx:104-121`: EmptyState
`action` slot + a bordered "Clear filters" button calling the page's own clear fn):
- Leads (`leads-view.tsx:490`): when `hasFilters`, EmptyState gains the action calling
  the existing clear-all path (`leads-view.tsx:292` — reuse that exact function so
  saved-view/URL semantics stay consistent; do NOT invent a second reset).
- Unmatched (`unmatched/page.tsx:425`): it has search + state filter (+ sort). Add a
  `hasFilters` derivation (q or state set); action clears q + state filter.
- Imports (`imports/page.tsx:86-91`): already branches on `hasFilter` (date range);
  action clears the range.
- Keep title/description branching as-is; the button matches Activity's styling
  verbatim (or promote the button into a tiny shared component if the copy would be
  its 4th duplication — 4 sites total = promote per FRONTEND_STANDARDS §2: a
  `ClearFiltersButton` or an `EmptyState` convenience prop; choose one, state it).
- Tests: `N3B-03/C-54: leads filtered-empty offers Clear filters` style component
  tests where the harness allows; otherwise a render test on one site + manual-verify
  note.

## Out of scope
Row-click (Q5, N3c), sort emphasis (C-68, N3c), any table content change, Dialog
pinned title (C-65, N3c), MapCaption. No new dependencies.

## Tests
tsc + lint clean; targeted unit tests with `--maxWorkers=4`. Visual sanity via the
gallery page if it renders these primitives.
