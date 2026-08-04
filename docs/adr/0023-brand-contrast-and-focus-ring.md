# ADR-0023: Marigold-fill text token + brand-ink focus rings (WP-C refinement)

- **Status:** Accepted (owner-approved in the WP-C build session, 2026-07-11)
- **Date:** 2026-07-11
- **Phase / WP:** Phase 2 · Survey identity WS-1.5 · WP-C (primitive re-skin)
- **Refines:** ADR-0022 (Survey visual identity)

## Context

WP-C's approved design doc (`docs/superpowers/specs/2026-07-11-wpc-primitives-design.md` §2)
recorded two owner decisions: (1) text on the marigold fill (primary Button, Checkbox
checkmark) → the existing `--text` (ink) token; (2) focus rings → `--brand-strong`. The
TDD anchor written first (`tests/unit/tokens.test.ts`) **falsified both** with the same
WCAG relative-luminance math the suite uses:

- `--text` is **theme-flipping** — near-white (`#EAF0EE`) in dark. The marigold fill is
  mid-tone in *both* themes (`#E0912B` light / `#F0A63E` dark), so ink-on-marigold is
  6.25:1 light but **1.78:1 dark** (fails SC 1.4.3). Text on the marigold fill therefore
  needs a **theme-invariant dark** value, which `--text` cannot be.
- `--brand-strong` (`#C67D1E`) is 3.31:1 on `--surface` (where fields sit) but **2.99:1
  on the `--bg` paper ground** — 0.01 under the 3:1 non-text bar (SC 1.4.11) for controls
  sitting directly on paper (error-page CTAs, appearance cards).

## Decision

Both approved values are provably below AA, so they were revised **in-session with owner
approval** (the owner confirmed the focus-ring pivot and was informed the ink-token option
was infeasible):

1. **Add `--brand-contrast` = `#20160A`** — a theme-**invariant** near-black (identical in
   light and dark) used only for TEXT on the marigold fill (primary Button, Checkbox
   checkmark, the two chrome/error-page CTAs, the notification-count badge, selected
   calendar days). Verified 6.99:1 light / 8.66:1 dark on the fill, and 5.38:1 / 10.09:1
   on the `hover:bg-brand-strong` state.
2. **Focus rings → `--brand-ink`** (`#8F5416` light / `#F0A63E` dark), including the global
   `:focus-visible` outline and the paired `focus-visible:border-*`. `brand-ink` clears
   ≥3:1 against **both** `surface` and paper in both themes (6.09–8.75:1). Per owner
   feedback the ring/outline was thinned to **1px** (from 2px) so the muted amber reads as a
   quiet line, not a halo — contrast is width-independent, so AA is unaffected.

`--brand-strong` remains the hover/active **fill** color (its role is unchanged; it was
only rejected as a *text* and *focus-indicator* color). The token contrast test now guards
this contract: `brandContrast/brand ≥ 4.5` and `brandInk/{surface,bg} ≥ 3`, both themes.

Alternatives considered: **darken `--brand-strong`** to clear 3:1 on paper — rejected, it
would shift the hover-fill hue for a focus-only need; **`--brand-strong/50` opacity rings**
(the pre-WP-C state) — rejected, ~1.3:1, fails.

## Consequences

- One additive token (`--brand-contrast`); no hex in component code (PRN-12 intact). The
  Survey identity (ADR-0022) is unchanged in spirit — this is the AA-correct realization of
  its "petrol-ink on the marigold highlighter" and "restrained focus" intents.
- The WP-C design doc/plan (which recorded the superseded `text-text`/`brand-strong`
  choice) are annotated to point here; this ADR is the source of truth for the pivot.
- Governance: the pivot was owner-approved during the build rather than before it, because
  the TDD anchor is what surfaced the AA failures — recording it here closes the
  Playbook §5 loop (deviations get an ADR, owner-approved).
