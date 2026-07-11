# WP-D — Survey Maps Reskin — Design

**Date:** 2026-07-11 · **Status:** proposed, pending owner sign-off
**Branch:** `phase-2/distribution` · **Prereqs:** WP-A `0f7cb4d`, WP-B `5d67bac`, WP-C `87d4b79`
**Inputs (read first):** `docs/design-reinvention/IMPLEMENTATION-PLAN.md` §WP-D + §"Known mockup↔app deltas"; `DIRECTION.md` §"Signature element (revised 2026-07-11)"; mockups `03-admin-coverage.html`, `01-admin-dashboard.html`, `_usmap.js` (reference only).

## 1. Scope

Reskin the two existing map components to the Survey identity — **components only, no page bodies** (pages are WP-E):

- `src/components/CoverageMap.tsx` — US **hex cartogram** (51 states). Consumed by `/partners/[id]` (single-partner highlight) and `/unmatched` (gap view).
- `src/components/CountyCoverageMap.tsx` — real US **county choropleth** (3,142 counties, `public/geo/us-counties.json`). Consumed by `/coverage` (the signature screen), paired with the keyboard **Partners companion list**.

The mockups' dissolved geometry is **mockup-only**; the app keeps its real hexgrid + `us-counties.json`. Only the visual *style* transfers.

**Out of scope (do not touch):** which page uses which map; page bodies/layouts; the coverage page's companion list; `src/modules/coverage/map.ts` (pure view-model — unchanged); geometry assets; the spawned "status-fill contrast in dark mode" follow-up.

## 2. Design decisions (brainstorm outcomes)

| # | Decision | Rationale |
|---|---|---|
| **Hatch** | **Hybrid.** Uncovered territory → diagonal SVG `<pattern>` hatch: `--warn` lines over a `--warn-soft` wash. `gap` states (uncovered **with** waiting leads, ASN-03) additionally keep the dashed `--warn` ring + marker dot — the actionable escalation, on the **hex map** (used by `/unmatched`). County map shows the hatch alone. | Hatch is a **texture** channel → covered/uncovered survives color-blindness (PRN-14) and is the distinctive "plat/survey" identity DIRECTION spends boldness on. A `<pattern>` referenced by `fill="url(#id)"` is GPU-composited: no per-element or re-render cost. Two-level amber semantic (hatched = unclaimed; ring+marker = unclaimed **and** leaking leads) preserves the app's real ASN-03 signal the mockup lacked. |
| **Caption** | **Optional `caption?: { title: string; subtitle?: string }` prop** on each map, rendering the blurred `.mapcap` plate top-left when provided. Component owns chrome; pages pass content in WP-E. | Delivers the plan's "caption plates" acceptance in WP-D as a tokenized, reusable affordance; **zero page-body work**; optional → current pages render unchanged. DS best practice: component owns the type treatment (Fraunces title / mono subtitle), exposes data. |
| **Consolidation** | **Shared internal module `src/components/map/`**, both components kept separate. Holds `MapHatch` (the `<pattern>`, id via `React.useId`), `MapCaption` (the plate), and `PARTNER_FILL_OPACITY = 0.9`. `contrastText` stays in `lib/contrast.ts`; add pure `contrastHalo()` there. | Guarantees theme + visual parity (kills mockup-style drift), one tuning home (scalable/flexible), no page-import changes, no runtime cost. Centralizes the on-fill contrast logic (the "centralize contrastText" ask; folds in F-19/F-1). |
| **Keyboard/hover** | **Keep the companion-list pattern** (owner's call). Maps stay `role="img"` + descriptive `aria-label`; the page's keyboard companion remains the keyboard path. Hover tooltips stay a mouse-only enhancement (already `pointer-events-none`). | Settled R3 WS-8 / MAP-02 decision. Reduced-motion is already honored globally (`globals.css` `@media (prefers-reduced-motion: reduce)` resets `transition-duration`/`animation-duration` with `!important`, overriding inline `transition`) — no per-component gating needed. |

## 3. Architecture — shared map internals

New folder `src/components/map/` (internal to the two map components; **not** re-exported from `@/components`):

- **`mapStyle.ts`** — `export const PARTNER_FILL_OPACITY = 0.9;` and any shared literals. Pure, no JSX.
- **`MapHatch.tsx`** — `MapHatch({ id }: { id: string })` renders `<defs><pattern id={id} …>` for the uncovered-territory hatch:
  ```
  <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width={6} height={6} fill="var(--warn-soft)" />
    <line x1={0} y1={0} x2={0} y2={6} stroke="var(--warn)" strokeWidth={1} />
  </pattern>
  ```
  `patternUnits="userSpaceOnUse"` → the hatch is **continuous across county borders** within a multi-county uncovered state (not per-path tiled). Each consuming `<svg>` renders one `<MapHatch id={useId()} />` and fills uncovered shapes with `fill={`url(#${id})`}`.
- **`MapCaption.tsx`** — `MapCaption({ title, subtitle }: { title: string; subtitle?: string })` renders an absolutely-positioned, blurred plate (HTML, inside the map's `relative` wrapper):
  - `background: color-mix(in srgb, var(--surface) 88%, transparent)`, `backdrop-filter: blur(6px)`, `border-border`, `rounded-xl` (12px — governed, not the mockup's off-scale 10px), `left-3.5 top-3.5`.
  - title: `font-display` (Fraunces) `text-[1.3rem]`, `text-wrap: balance`; subtitle: `num` (IBM Plex Mono) **`text-[.8125rem]` (13px)** `tracking-[.04em] text-text-3` — bumped from the mockup's `.68rem` to honor the WP-A/C "no chrome text < 13px" rule.

### `lib/contrast.ts` change

Add a pure sibling to `contrastText` (preserves the exact current halo pixels, just relocates them out of component code):

```ts
/** Translucent halo tone that separates on-fill label text from a busy partner fill. */
export function contrastHalo(hex: string): string {
  return contrastText(hex) === "#ffffff" ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.6)";
}
```

## 4. Component changes

### CoverageMap.tsx (hex)
- Covered hexes: `fill={cov.color}` at `fillOpacity={PARTNER_FILL_OPACITY}` (0.9); dimmed (non-selected in highlight mode) stays 0.28-ish.
- Uncovered hexes: `fill={`url(#${hatchId})`}` (amber hatch) — replaces the flat `var(--surface-3)`.
- `gap` hexes: hatch fill **plus** the existing dashed `--warn` ring (`strokeWidth 2`, `strokeDasharray "3 2"`) + `--warn` marker dot — unchanged escalation.
- Labels: `fill={contrastText(cov.color)}`; halo `stroke={contrastHalo(cov.color)}` — **removes the raw `rgba(...)` literals** (PRN-12 fix). Uncovered label → `--text-2`.
- Separators/hover strokes stay token-based (`--surface`, `--text`) — already compliant.
- Add optional `caption` prop → render `<MapCaption>` in the `relative` wrapper. Render `<MapHatch id={hatchId} />` as first child of `<svg>`.
- `role="img"` + aria-label retained.

### CountyCoverageMap.tsx (county)
- Covered counties: `fillOpacity={dimmed ? 0.25 : PARTNER_FILL_OPACITY}` (0.9 for the survey-paper look).
- Uncovered counties: `fill={`url(#${hatchId})`}` — replaces flat `var(--surface-3)`.
- State borders / hover-county highlight strokes: keep token-based (`--surface`, `--text`), `vectorEffect="non-scaling-stroke"` preserved.
- Add optional `caption` prop → `<MapCaption>`; render `<MapHatch id={hatchId} />` inside `<svg>` (outside the pan/zoom `<g>` is fine; inside is acceptable — hatch scaling with zoom is natural).
- **Perf architecture preserved verbatim:** module-level geo cache, memoized `countyPaths` (re-runs only on geometry/selection change, never on hover), event-delegated hover + single overlay path, non-passive wheel handler. No new per-hover work.
- `role="img"` + aria-label retained; zoom buttons already tokenized.

## 5. Token discipline (PRN-12)

Every value consumed from tokens; **no raw hex/rgba in component code** after this WP. Palette used: `--warn`, `--warn-soft` (hatch), `--surface`/`--surface-2`/`--surface-3`, `--border`, `--text`/`--text-2`/`--text-3`. Partner fills come from `PARTNER_SWATCHES` (paired with name + `JV-###` via `PartnerTag`, PRN-14). `contrastText`/`contrastHalo` are computed a11y colors living in `lib/contrast.ts` (not design tokens — same home the F-19 fix already uses and the audit blessed).

## 6. Test plan (TDD — logic first)

Only genuine logic is the pure contrast layer; components get focused render assertions.

**`tests/unit/contrast.test.ts`** (extend — write first, watch fail, implement `contrastHalo`):
- `it("F-19: contrastText picks a readable on-fill label for every partner swatch")` — iterate `PARTNER_SWATCHES`, assert each returns `#111111` or `#ffffff` and is the higher-contrast choice vs the fill.
- `it("F-19: contrastText returns the higher-contrast label …")` + `it("SC 1.4.3 (ADR-0024): on-fill label contrast holds its documented floor …")` — **(build note, corrected during TDD):** the original "0.9 never flips the pick" idea was wrong — `contrastText` is theme-blind, so it differs from the theme-composited fill at the luminance crossover in *either* direction. What matters is measured contrast, not pick-stability. The real finding: on-fill 11px labels are **SC 1.4.3 (4.5:1)** text (not SC 1.4.11/large-text), and the saturated tints reach only ~3.74:1 worst at 0.9 opacity (largely pre-existing). Resolved per **ADR-0024** (owner-approved): keep `contrastText` + halo, document the carve-out (labels are haloed + redundantly identified at solid AA via tooltip + companion). Tests now assert optimality of the pick and pin a regression floor (≥3.7:1) with the SC cited correctly.
- `it("F-19: contrastHalo returns the opposite translucent tone")` — `contrastHalo` pairs with `contrastText` (white label → `rgba(0,0,0,0.3)`, dark label → `rgba(255,255,255,0.6)`); unparseable → dark-label pairing; never throws.

**`tests/unit/components/coverage-maps.test.tsx`** (new, `// @vitest-environment jsdom`, testing-library):
- `it("MAP-01: hex map renders a hatch fill for uncovered states")` — a `<pattern>` def exists and ≥1 uncovered polygon references `url(#…)`.
- `it("MAP-01: hex map keeps the warn ring + marker on gap states")` — a gap state polygon has dashed `--warn` stroke and a marker `<circle>`.
- `it("MAP-01: hex map labels use the shared contrast picker, not raw white")` — labelled hex `fill` matches `contrastText` for its partner color.
- `it("MAP-01: map renders the caption plate only when caption is provided")` — title/subtitle present with prop, absent without; both maps.
- `it("MAP-01: maps expose role=img with a descriptive label")` — both maps.
- County map: render with a stubbed `geoCache` (or the fetch mock the existing tests use) → assert uncovered counties reference the hatch and covered use `fillOpacity` 0.9.

Requirement-ID test names (MAP-01, F-19). Suite runs **serially** (`--no-file-parallelism`) per the env blocker.

## 7. Acceptance / Definition of Done

- `pnpm run typecheck` + `pnpm run lint` clean.
- Unit + component suites **serial-green** (`--no-file-parallelism`).
- Both maps render in **both themes** (verified in the visualize walkthrough, since the browser-preview renderer is env-blocked).
- **No raw hex/rgba** in `CoverageMap.tsx` / `CountyCoverageMap.tsx` (PRN-12); halos relocated to `lib/contrast.ts`.
- `contrastText`/`contrastHalo` applied to on-fill labels (F-19/F-1).
- Uncovered = amber hatch; gap = hatch + ring + marker (hex); caption plate ships behind an optional prop.
- Companion-list / keyboard pattern intact (R3 WS-8 / MAP-02); `role="img"` + aria-labels retained.
- PLAYBOOK §6 self-audit printed; `pr-reviewer` + `/audit frontend` on the diff; findings addressed.
- Owner walkthrough (visualize widget) approved.
- **One commit** for WP-D.

## 8. Deferred (WP-candidates, not built here)
- County-map per-state gap escalation (ring/marker) — page-composition concern; revisit in WP-E if wanted.
- Caption *content* wiring on each page — WP-E.
- DSN-11 (map type-scale steps into `@theme`) — tracked from WP-C.
