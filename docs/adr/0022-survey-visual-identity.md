# ADR-0022: "Survey" visual identity v2 (token swap)

- **Status:** Accepted (owner-approved direction 2026-07-10, real-map revision 2026-07-11)
- **Date:** 2026-07-11
- **Phase / WP:** Phase 2 · Survey identity WS-1.5 · WP-A
- **Supersedes:** the "minimal-slate" identity note in `src/lib/tokens/tokens.ts`

## Context

The 2026-07-10 front-end design audit found the app's engineering ahead of its visual
identity: one system font for both display and body at a 14px root, sub-10px chrome text,
geography (the product's one ownable asset) treated as a widget, and a "slate + green"
palette that was inherited rather than chosen. The approved remedy is the **"Survey"**
direction (`docs/design-reinvention/DIRECTION.md`): cool petrol survey-paper neutrals, one
marigold signal ("route"), petrol ink, a real US coverage choropleth as the signature, and
a three-face type system. The token architecture (`tokens.ts` + `globals.css` → Tailwind /
email / export, SEAM-08) is deliberately kept — the rebrand is exactly the value-swap that
PRN-12 was designed for.

## Decision

Adopt Survey as a **value swap on the existing token architecture** (WP-A), not a refactor.

1. **Keep-names.** Every existing CSS-var / TS-key name is retained; only values change
   (owner decision — smallest diff, no churn across token consumers or the test harness).
   Two **additive** roles that DIRECTION lists but the file lacked are introduced:
   - `brandInk` (route-ink) — the amber **text/link** tone. Required because `brand`
     becomes the marigold **fill** `#E0912B`, which is ~1.9:1 as text and cannot be read.
     Every `text-brand`/`text-brand-strong` used as text was repointed to `text-brand-ink`
     (fills/borders keep `brand`); the `:focus-visible` ring moved to `brand-strong`.
   - `borderStrong` (line-strong) — the stronger hairline for table rules/dividers (first
     consumed by the WP-C Table re-skin).
2. **Warn darkened.** DIRECTION's light `--warn #B9741C` measured 3.76:1 on white — below
   the AA body-text bar. Darkened to **`#985E15`** (5.32 white / 4.81 paper) so the token
   contrast test stays one uniform ≥4.5 rule rather than carving out a signal-only
   exception. (Dark `#E0973A` already passed.)
3. **`prev` → taupe.** "Previously matched" (DED-02) moved off its banned purple to a warm
   stone/taupe (`#6E5C46` / `#CBB89C`) — distinct from all five status hues, reading as a
   pencil annotation on survey paper.
4. **Type.** Fraunces (display) / Hanken Grotesk (body) / IBM Plex Mono (data) loaded via
   `next/font/google` (no new dependency). Root 16px (from 14px); 1.2 scale defined as CSS
   vars for per-page adoption in later WPs.
5. **Partner palette.** The 9-partner roster keeps its names, taking 9 of the DIRECTION
   "printed-map region" tints; ochre is held back into the extended swatch pool so it does
   not read as the route marigold.
6. **Route-line concept rejected.** The earlier "marigold lead→partner route arc" gesture
   was cut per owner feedback; the real coverage choropleth carries the identity.

**Goldens: none re-pinned.** Investigation confirmed no golden encodes the production
partner palette — `golden.test.ts` (TST-05) pins pipeline *semantic* outcomes; the
export/coverage tests compute from their own literal input hexes; `partners-colors.test.ts`
uses pool *indices*. Verified empirically: the full unit suite (incl. TST-05) stays green
after the swap. This corrects the WP-A plan's inherited assumption that the palette change
would flow into an export golden; DM-08 is not engaged because partner colors are not a
rules-snapshot input.

All text/badge pairs are AA-verified in **both** themes by the computed-contrast assertions
in `tests/unit/tokens.test.ts` (the regression gate a future token edit cannot bypass).

## Consequences

- One coherent identity, inherited automatically through the single token source
  (SEAM-08): the Excel export takes the new partner tints for free via `partner.color`.
  (Digest/invite emails are plain text today — they carry no color tokens yet; styling them
  as brand surfaces is WP-G.)
- `brandInk`/`borderStrong` are the only structural additions; consuming code references
  semantic tokens only (PRN-12), never hex.
- The marigold-as-text repoint touched primitives (Badge, Select, DatePicker, Tabs, etc.)
  beyond the page set, to keep AA clean at every step. WP-B/WP-C still own those
  components' structure and variant semantics (e.g. badge on-state = route); this ADR only
  fixed their text-color token.
- No golden re-pin; no new runtime dependency; `next/font` fetches faces at build time
  only. Rebranding or per-tenant white-label (SET-09) remains a value swap here.
