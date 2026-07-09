# ADR-0017: Recharts for all charts

- **Status:** Accepted (REDESIGN-R3 decision D2)
- **Date:** 2026-07-09
- **Phase / WP:** Phase 2 · REDESIGN-R3 WS-1

## Context

The dashboard trend chart and the source-mix visualization are hand-rolled SVG. As the
dashboard is reworked (WS-2) to a multi-series trend line (Leads in / Distributed /
Unmatched, with time ranges and comparison deltas) and a removed-by-source donut with
center total and a labeled legend, hand-rolled SVG would mean re-deriving axes, scales,
tooltips, legends, responsive sizing, and enter transitions — and doing so while
honoring PRN-14 (every series identified by name, never color alone).

## Decision

Adopt **Recharts** for all charts. Wrap it in three app components so pages never touch
Recharts directly and PRN-14 is enforced at the wrapper:

- `ChartContainer` — responsive sizing + shared token theming (axes, grid, tooltip).
- `LineChart` — multi-series line; legend shows each series **name**; the tooltip lists
  name+value per series (never color alone).
- `DonutChart` — center total, labeled legend with counts + percentages, name in tooltip.

Colors come from design tokens (PRN-12). New dependency: `recharts`.

Alternatives considered: **visx / D3-direct** (maximum control, but we would rebuild the
axis/tooltip/legend layer Recharts already provides); **Chart.js** (canvas — harder to
token-theme and to make the legend/tooltip carry names accessibly); **keep hand-rolled
SVG** — rejected: does not scale to the WS-2 requirements and repeatedly risks PRN-14.

## Consequences

- Charts become declarative and consistent; PRN-14 is guaranteed by the wrapper API
  (a caller cannot render a series without a name).
- Bundle grows by Recharts on chart-bearing routes; those routes code-split in later WPs.
- Recharts owns responsiveness and interaction, removing a class of hand-rolled bugs.
