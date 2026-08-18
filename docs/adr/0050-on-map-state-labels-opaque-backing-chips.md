# ADR-0050: On-map state labels return via opaque backing chips (Unmatched gap map)

- **Status:** Accepted
- **Date:** 2026-08-18
- **Phase / WP:** Phase C · Slice 5 · WP-UX-4 (Unmatched gap map — on-map labels + anchored legend)
- **Relates to:** ADR-0024 (superseded on-fill label carve-out) · ADR-0029 (retired the carve-out)
  · `docs/FRONTEND_STANDARDS.md` §7 · PRN-14, PRN-12, PRN-15, PRN-10

## Context

The Unmatched choropleth (`src/app/(admin)/unmatched/page.tsx`) shades states by unmatched-lead
volume. The exact count is available only on hover, in the state filter chips, and in the
"Largest gap" stat tile — so **on the map itself, magnitude is conveyed by color alone**. That is
the PRN-14 defect the WP-UX-4 audit finding names, and SC 1.4.1 (Use of Color) with it. The
legend compounds it: `Fewer → More` with no numbers anchors the ramp to nothing.

The obvious fix — draw the state code and count on the map — is exactly what ADR-0024 analysed
and ADR-0029 retired. ADR-0024 measured on-fill text at a **worst of ~3.74:1**, with **10 of 40
swatch×theme combinations under 4.5:1**, and accepted it only as a bounded carve-out conditioned
on a halo plus redundant AA identification. ADR-0029 then deleted the last consumer and returned
§7 to "fills keep AA text contrast, no exceptions", with the standing rule that **the carve-out
does not silently revive**: any future on-fill map text needs its own ADR. This is that ADR.

ADR-0024 already named the compliant alternative it declined at the time — an **opaque `--surface`
backing chip** behind each label, "genuinely meets 1.4.3" — and ADR-0029 pointed at it as the way
back. The aesthetic objection that sank it ("per-label chrome against the minimal map look") does
not apply here: the Unmatched map is an exception-queue diagnostic, gap states are structurally
few, and the chip is the thing that makes the map readable at all.

## Decision

Reintroduce on-map text to a choropleth **only** in ADR-0024's pre-analysed compliant form.

- Each labeled state draws `{USPS} · {count}` inside an **opaque backing chip**: fill
  `var(--surface)`, 1px `var(--border-strong)` stroke, `rx` 4, 13px `var(--font-mono)`. Never
  text on the tint itself. `--border-strong` (not `--border`) so the chip edge survives on dark
  `--map-land`.
- Because the backing is opaque, label contrast is **independent of the heat-ramp fill** and of
  fill opacity. The theme pairs measure ≈15.9:1 / ≈13.9:1 for the count (`--text` on `--surface`,
  light/dark) and ≈7.4:1 / ≈7.9:1 for the code (`--text-2`), with the `·` separator at ≈5.9:1 /
  ≈5.6:1. **SC 1.4.3 is met outright**: the ADR-0024 carve-out is *not* revived and
  `FRONTEND_STANDARDS.md` §7 remains "fills keep AA text contrast, no exceptions."
- 13px is the WP-A/C chrome floor (`--text-step-1`), so no DSN-11 glyph-fit exception is needed —
  `NotificationBell` stays the only one (ADR-0029).
- **Scope:** the opt-in `stateLabels` layer of `CountyCoverageMap`, consumed today only by
  `/unmatched`. With the prop absent the layer renders zero DOM, so /coverage, /dashboard and the
  portal map are untouched by construction.
- The labels are `aria-hidden` **presentational duplicates**: the SVG is already `role="img"`, and
  screen-reader and keyboard users get the same data at AA quality from the state filter chips,
  the stat tiles, and the table. This is the ADR-0024 redundancy condition, retained even though
  it is no longer load-bearing for contrast.
- Label placement uses a **committed anchor table** (`src/lib/geo/us-state-anchors.ts`) — DATA
  (PRN-10), generated offline from the county geometry and hand-tuned, with nine small seaboard
  states drawn as a fixed leader-line callout column. Static ⇒ deterministic ⇒ **no runtime
  collision solver, ever**. The generator itself is not committed; its method and verification
  are recorded in the file's provenance header.
- The legend is anchored to the real `min`/`max` of the same served stats (PRN-15) and stops
  being `aria-hidden` decoration: it becomes `role="img"` with a range sentence.
- **Any future on-fill map text WITHOUT an opaque backing requires its own ADR**, under the
  ADR-0029 rule. This decision does not license it.

Alternatives considered:

- *Halo-only text* — rejected: ADR-0024 already established the halo is not a WCAG-recognised
  technique for SC 1.4.3.
- *Translucent backing* — rejected: reintroduces the fill×theme contrast matrix the opaque chip
  eliminates.
- *On-tint text with a luminance-picked color* — rejected: the retired F-19 mechanism, worst
  ~3.74:1.
- *Counts only in the hover/chips (status quo)* — rejected: that IS the finding.
- *In-map legend plate instead of the header legend* — rejected: the map's corners are already
  spoken for (caption plate top-left, zoom controls bottom-right), and the header legend exists
  at every breakpoint including the phone static map.

## Consequences

- Easier: the gap map is readable without a pointer, in a screenshot, and on the phone's static
  map. `FRONTEND_STANDARDS.md` §7 needs no carve-out text — the standard holds as written.
- Harder: label positions are a committed table, so a change to the map geometry (a new
  `us-counties.json`) means regenerating and re-verifying the anchors, the same lockstep
  obligation `us-state-fips.ts` already carries. `tests/unit/geo/us-state-anchors.test.ts` is the
  tripwire.
- The anchor table is spaced for a worst-case 8-character chip. A tenant with 25+ gap states
  would still get a busy map; the knob if that day comes is a `maxLabels` prop with "top-N by
  count, chips cover the rest" — deliberately NOT built now (spec §10 #4).
- Reopens if: the map is ever asked to label counties (a different density problem entirely), or
  if a surface needs map text where an opaque backing is unacceptable — either way, a new ADR.
- `tests/unit/wcag.test.ts` pins both chip text pairs in both themes and cites this ADR, not
  ADR-0024.
