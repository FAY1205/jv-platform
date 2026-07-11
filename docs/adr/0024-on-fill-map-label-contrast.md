# ADR-0024: On-fill map label contrast — documented SC 1.4.3 carve-out (WP-D)

- **Status:** Accepted (owner-approved in the WP-D build session, 2026-07-11)
- **Date:** 2026-07-11
- **Phase / WP:** Phase 2 · Survey identity WS-1.5 · WP-D (maps)
- **Refines:** ADR-0022 (Survey visual identity) · `docs/FRONTEND_STANDARDS.md` §7

## Context

The coverage maps label each state with its 2-letter code drawn **on the partner
tint**. Since the F-19 fix the label color is chosen by luminance (`contrastText`
picks the higher-contrast of black/white) with a contrasting halo (`contrastHalo`)
for edge definition. WP-D softens covered fills to ~0.9 opacity (the survey-paper
look) and centralizes this on-fill contrast logic.

`FRONTEND_STANDARDS.md` §7 / PRN-14 require that **fills keep AA text contrast
(SC 1.4.3 = 4.5:1)** in both themes. Measured against the full 20-swatch roster at
0.9 opacity composited over both theme surfaces: the on-fill 11px/600 codes reach a
**worst of ~3.74:1**, and **10 of 40 swatch×theme combinations fall under 4.5:1**.
This is **largely pre-existing** — the solid-fill worst was already ~4.25:1 before
WP-D (the F-19 pick never cleared 4.5:1 on the most saturated tints); the 0.9
opacity modestly worsens it. The halo aids edge legibility but is **not** a
WCAG-recognized technique for satisfying SC 1.4.3, and 11px/600 text is below the
large-text threshold, so SC 1.4.11's 3:1 graphical-object bar does **not** apply
(an earlier draft of the WP-D contrast test wrongly cited it — corrected here).

## Decision

Accept the on-fill 2-letter state codes as a **bounded, documented exception** to
§7's SC 1.4.3 requirement, because the label is **non-essential, redundant**
content:

- Every label's information — state name, owning partner name + `JV-###`, lead
  counts — is available at **solid AA contrast** through two independent paths that
  work by pointer *and* keyboard: the hover tooltip (a solid `--surface` card with
  `PartnerTag`) and the page companion list (the Partners buttons / tables that are
  the MAP-02 keyboard control). The 2-letter code is also position-derivable on a
  US map.
- The label keeps the F-19 mechanism (max-contrast black/white) **plus** the
  contrasting halo — the most legible on-fill rendering short of adding an opaque
  backing.

**Scope of the exception:** small (≤~12px) labels drawn on partner-tint **map**
fills that (a) carry a contrasting halo and (b) have redundant AA identification on
the same surface. It does **not** relax §7 for any other fill+text — badges, chips,
buttons, table cells, legend swatches all still owe 4.5:1.

**Alternative considered — opaque `--surface` backing chip** behind each code (glyph
on a fixed theme color → ~13:1, genuinely meets 1.4.3). Rejected for now: it adds
per-label chrome that works against the approved minimal map aesthetic. It becomes
the required fix if the map is ever shown **without** the redundant tooltip/companion
(e.g. a static export thumbnail), or if the palette is darkened past legibility.

## Consequences

- `FRONTEND_STANDARDS.md` §7 gains a one-line carve-out pointing here; the standard
  is otherwise unchanged.
- `tests/unit/contrast.test.ts` guards the contract honestly: `contrastText` returns
  the **higher-contrast** label (F-19 optimality), `contrastHalo` pairs the opposite
  tone, and a **regression floor** pins the measured worst-case on-fill contrast
  (~3.74:1) so it cannot silently degrade further. The test cites **SC 1.4.3** (not
  1.4.11) and references this ADR.
- If the redundant identification paths are ever removed, or the code becomes the
  sole identifier of a datum, this exception lapses and the backing-chip (or a
  darker partner palette) must be adopted.
