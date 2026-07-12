# WP-P — sub-13px type pass (cleanup menu slice B2)

**Date:** 2026-07-12
**Branch:** phase-2/distribution
**Tier:** B (design-system token discipline; DSN-11 follow-up to WP-K)

## Problem

WP-K built the `text-step-0..7` ladder (floor `text-step-0` = 12px) and swept all
font-size arbitraries **except** 5 sub-12px sites, which were left with inline
"DSN-11 gap … pending slice B/D" comments. Six sub-floor font-size literals remain
(verified against real code 2026-07-12):

| # | Site | Literal | Role |
|---|------|---------|------|
| 1 | `PartnerTag.tsx:32` | `text-[.66rem]` | partner refId (≈16 call sites via PartnerTag) |
| 2 | `NotificationBell.tsx:137` | `text-[.62rem]` | dropdown day-group label ("TODAY") |
| 3 | `CoverageMap.tsx:118` | `text-[.7rem]` | hover-tooltip "N leads received" line |
| 4 | `gallery/page.tsx:186` | `text-[.66rem]` | token varName (docs-only) |
| 5 | `NotificationBell.tsx:105` | `text-[.6rem]` | unread-count badge glyph (inside a 16px circle) |
| 6 | `CoverageMap.tsx:81` | `fontSize: 11` | on-polygon 2-letter hex labels (SVG attr) |

## Decision (owner, option C)

Snap the **4 readable-text** sites (1–4) to `text-step-0` (12px). **Carve out** the
**2 glyph-fit** sites (5–6) — they are sized to fit their container (a 16px badge
circle; small map polygons), not to a reading step, and 12px risks overflow. Keep
them at their raw values with a **formal "glyph-fit, not type-scale" exemption**
documented in FRONTEND_STANDARDS, mirroring WP-H's §3 algorithmic-literal carve-out.

No new ladder tier (option B rejected — don't grow the just-approved 0–7 ladder for
two glyph cases). No forced bump on constrained glyphs (option A rejected — layout risk).

**PartnerTag `size="sm"` hierarchy (owner-confirmed, keep):** snapping refId to 12px makes
it equal in size to the sm name (also 12px). Kept — the hierarchy stays clear via three
non-size channels (mono `.num` vs sans typeface, `font-medium` vs the wrapper's
`font-semibold`, muted `text-text-3` color); a sub-12px refId would reintroduce the DSN-11
debt this pass removes and is less legible for functional reference data (PRN-14 holds).

## Changes

**Resolve → `text-step-0`** (font-size only; step-0 has no line-height companion, so
render-neutral on line-height):
- `PartnerTag.tsx:32` `text-[.66rem]` → `text-step-0`; drop the now-moot DSN-11 gap comment (line 30).
- `NotificationBell.tsx:137` day-group label — the wrapping `DropdownMenuLabel` primitive
  already applies `text-xs` (12px), so the `text-[.62rem]` override is simply DROPPED (no
  stacked font-size class); the label inherits the primitive's 12px. Keep `uppercase
  tracking-wide text-text-3`.
- `CoverageMap.tsx:118` `text-[.7rem]` → `text-step-0`; drop the gap comment (line 117).
- `gallery/page.tsx:186` `text-[.66rem]` → `text-step-0`.

**Carve out (formalize, no value change):**
- `NotificationBell.tsx:105` badge `text-[.6rem]` — keep; update the inline comment from
  "pending the sub-13px pass" to reference the glyph-fit exemption (resolved as a deliberate carve-out).
- `CoverageMap.tsx:81` `fontSize: 11` — keep; comment it as a glyph-fit SVG label carve-out.

**Guard (`tests/unit/type-scale.test.ts`):**
- Add `text-[.62rem]`, `text-[0.62rem]`, `text-[.66rem]`, `text-[0.66rem]`, `text-[.7rem]`,
  `text-[0.7rem]` to `BANNED` (regression floor for the 4 resolved spellings). Do **NOT**
  ban `text-[.6rem]` — the badge glyph carve-out keeps it. (`.6rem` is not a substring of
  the banned `.66rem`/`.62rem`/`.7rem`, so no false match.)
- Update the header comment: 4 resolved in B2 → step-0; the 2 glyph-fit carve-outs
  (`.6rem` badge, `fontSize:11` SVG) remain by design.

**Standards (`docs/FRONTEND_STANDARDS.md` §2):**
- Add a bullet: type sizes come from the `text-step-0..7` ladder (DSN-11), guarded by
  `type-scale.test.ts`; **Exception (glyph-fit, not type-scale):** the bell unread-count
  badge and the CoverageMap on-polygon hex labels are container-fit sizes, excluded from
  the ladder.

## Out of scope

- Any ≥12px site (LineChart Recharts `fontSize={12}` is already at the floor + a numeric prop).
- The default-scale migration (the 281 Tailwind `text-xs/sm/…` uses) — the ⭐ WP-K deferred item.
- Line-height companions for the ladder — WP-K deliberately kept step-* font-size-only.

## Verification

- `pnpm exec vitest run tests/unit/type-scale.test.ts --no-file-parallelism` green (guard
  catches the 4 resolved spellings if reintroduced; the 2 carve-outs pass).
- Full unit suite green serial; `pnpm typecheck` clean; eslint on changed files clean.
- Computed-style readback (throwaway route or the permanent /gallery PartnerTag card):
  refId renders at **12px**; badge count stays sub-floor and does not overflow its circle.
- Self-audit: PLAYBOOK §6 printed. Agents on the diff: **pr-reviewer** + **audit-design-system**
  (MANDATORY — token/type-scale discipline).
- One commit; explicit owner "go" before commit AND push.
