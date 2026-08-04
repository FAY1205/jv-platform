# WP-A — Survey token foundation (design)

**Date:** 2026-07-11 · **Status:** proposed, pending owner review
**Program:** "Survey" identity as WS-1.5, before REDESIGN-R3 WS-2..8 (owner-confirmed sequencing)
**Inputs:** `docs/design-reinvention/DIRECTION.md` (token source of truth), `IMPLEMENTATION-PLAN.md` (WP-A), current `src/lib/tokens/tokens.ts` + `src/app/globals.css` + `src/app/layout.tsx`.
**Method:** all values re-derived and verified with the same WCAG relative-luminance math as `tests/unit/tokens.test.ts` (scratchpad `derive.mjs`). No value below is guessed.

## 1. Confirmed decisions (owner, 2026-07-11)

1. **Sequencing:** land WP-A→B→C→D as WS-1.5 before the R3 page reworks.
2. **Warn:** darken light `--warn` to clear the ≥4.5:1 body-text gate (keep the contrast test one uniform rule).
3. **Fonts:** Fraunces (display) / Hanken Grotesk (body) / IBM Plex Mono (data), via `next/font/google`.
4. **Token names:** keep existing var/key names, swap values only. Two *additive* tokens are introduced (both are core roles listed in DIRECTION §Token system that the current file lacks): `brandInk` (= route-ink) and `borderStrong` (= line-strong). No renames.
5. **`prev` ("previously matched", DED-02):** re-mapped from banned purple to a **warm stone/taupe** (pencil-annotation reading, distinct from all five status hues).

## 2. Final token values (keep-names mapping, verified)

Current key → Survey role, with light / dark values. **★ = new additive token.**

| Key (unchanged) | Survey role | Light | Dark |
|---|---|---|---|
| `bg` | paper | `#F1F4F3` | `#10181C` |
| `surface` | surface | `#FFFFFF` | `#17232A` |
| `surface2` | surface-2 | `#E9EEEC` | `#1E2C33` |
| `surface3` | surface-3 | `#DDE5E2` | `#26363E` |
| `border` | line (hairline) | `#D3DCD9` | `#2A3A41` |
| `borderSoft` | line-soft (fainter) | `#E4E9E7` | `#223038` |
| `borderStrong` ★ | line-strong (rules/dividers) | `#B8C4C0` | `#3A4D55` |
| `text` | ink | `#16242B` | `#EAF0EE` |
| `text2` | ink-2 | `#46565D` | `#A9B8BC` |
| `text3` | ink-3 | `#566268` | `#85969B` |
| `brand` | route (marigold — **fill only**) | `#E0912B` | `#F0A63E` |
| `brandStrong` | route-strong (hover/active fill) | `#C67D1E` | `#F6B856` |
| `brandSoft` | route-tint (soft wash) | `#FAEFDA` | `#2A2417` |
| `brandLine` | route-line (marigold hairline) | `#EAD8AE` | `#4A3A1E` |
| `brandInk` ★ | route-ink (**amber text/links**) | `#8F5416` | `#F0A63E` |
| `info` | info (water blue) | `#2E6E93` | `#5FA0C8` |
| `infoSoft` | info-soft | `#E7EFF4` | `#1A2A33` |
| `warn` | warn (darkened) | `#985E15` | `#E0973A` |
| `warnSoft` | warn-soft | `#F7EEDA` | `#33291A` |
| `danger` | danger | `#B23A2E` | `#E06555` |
| `dangerSoft` | danger-soft | `#F7E4E1` | `#301E1B` |
| `success` | matched | `#2C7A57` | `#4FB183` |
| `successSoft` | matched-soft | `#E8F2EC` | `#173529` |
| `prev` | previously-matched (taupe) | `#6E5C46` | `#CBB89C` |
| `prevSoft` | prev-soft | `#EFE8DE` | `#2A251E` |
| `scrim` | scrim (petrol) | `rgba(22,36,43,.4)` | `rgba(0,0,0,.55)` |

`warn #B9741C` (DIRECTION) measured 3.76:1 on white → darkened to **`#985E15`** (5.32 white / 4.81 paper), the nearest ochre clearing both grounds. `route-strong` stays **fill-only** — it is 3.31:1 on white, fine as a hover fill and focus ring (≥3:1 UI-contrast) but never used as body text.

**Radii** (DIRECTION 4/8/12/16): add `--r-xs: 4px`; keep `sm 8 / md 12 / lg 16`. **Motion** unchanged (120/200/320 already present; DIRECTION's "320ms" ≈ existing `slow`). **Shadows** unchanged (petrol-tuned rgba already theme-split).

## 3. Verified AA matrix (both themes, ≥4.5:1)

Body text: ink/surface 15.9, ink-2/surface 7.6, ink-3/surface 6.3, ink-3/paper 5.7 (dark: 13.9 / 7.8 / 5.2 / 5.8).
Links/amber text: brand-ink/paper 5.5, brand-ink/surface 6.1 (dark 7.8).
Primary button (ink `#20160A` on marigold): 6.99 light / 8.66 dark.
Badge text-on-soft (light / dark): Distributed brand-ink·route-tint 5.34 / 7.50 · New info 4.79 / 5.16 · Unmatched warn 4.61 / 5.88 · Removed danger 4.84 / 4.64 · Matched 4.55 / 5.04 · Prev taupe 5.26 / 7.87 · neutral ink-2·surface-3 5.96 / 6.11.
Status text on surface: matched 5.2/6.1, info 5.6/5.6, danger 5.9/4.7, warn 5.3(white)/6.6.

## 4. Type system

Load via `next/font/google` in `layout.tsx`, exposing CSS variables, applied on `<html>`:
- **Fraunces** → `--font-display` (page titles, headline numbers, map plate title). Fallback: `ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif`.
- **Hanken Grotesk** → `--font-sans` (all running UI/body/labels/tables). Fallback: `system-ui, -apple-system, "Segoe UI", sans-serif`.
- **IBM Plex Mono** → `--font-mono` (ref-IDs, coordinates, counts). Fallback: `"SF Mono", "Cascadia Code", ui-monospace, "Roboto Mono", monospace`.

`globals.css`: root `font-size: 16px` (from 14px); body `line-height: 1.55`; base heading `line-height: 1.15` + `text-wrap: balance`. Define the 1.2 scale as CSS vars for adoption (7 steps, `.813 / 1 / 1.2 / 1.44 / 1.728 / 2.074 / 2.488rem`), uppercase micro-labels `letter-spacing: .08em`. `.num` mono utility unchanged. Per-heading application of the scale and the sub-13px purge happen per page in WP-E (plan §WP-A.3).

## 5. Partner palette (SET-02)

The 9 seeded partners keep their **names**; hexes become 9 of the DIRECTION map tints (ochre held back to the extended pool to avoid confusion with the route marigold):
clay `#B4623F`, sage `#6E8B5E`, slate-blue `#5B7A9E`, plum `#8A5A78`, teal `#3E8C8A`, rust `#A65A34`, moss `#57794C`, denim `#47688E`, brick `#9E4B45`.
`PARTNER_SWATCHES` = those 9 + ochre `#C79A3E` + additional vetted muted map tints (pine `#3E6B52`, wine `#7A3B45`, harbor `#2F6E7A`, dust `#8A7B57`, fig `#6B4A66`, olive `#6E7A3E`, sand `#B08A52`, indigo-slate `#3E5A7A`, terracotta `#B5764C`, seafoam `#5E9E8E`) for ≥18-color headroom (extended tints vetted as AA fills during build). `tokens.test.ts` asserts only the 9-roster (length/valid-hex/unique) — all pass. Every use still pairs swatch + name + `JV-###` (PRN-14). Export `contrastText()` picks black/white per fill, so all tints remain legible.

## 6. Forced AA-preserving repoints (required by the swap, in WP-A)

Because `brand` becomes marigold (too light for text), text usages must repoint to `brand-ink`; fills/borders (`bg-brand`, `bg-brand-soft`, `border-brand`, `hover:border-brand-line`) stay on `brand`. Scoped sites:
- `text-brand` → `text-brand-ink` (links/emphasis): `coverage`, `account/password`, `forgot`, `reset`, `upload`, `imports` (+ `[ref]`), `dev/emails`, `settings/data`, `dashboard` (Stat tone + closed count), `leads-view` (filter chip + row hover), `Tabs.tsx`, `StatusSelect.tsx` (Contacted).
- `text-brand-strong` → `text-brand-ink` (as text): `settings-nav` active item.
- `:focus-visible` outline `var(--brand)` → `var(--brand-strong)` (marigold fill is 1.9:1; route-strong is ≥3:1 UI-contrast, per DIRECTION mockups).

These keep the app AA-clean at every step. Badge *component* semantics (Distributed/New/Unmatched/Matched/prev variants, on-state=route) are finalized in WP-C; WP-A only ensures the tokens they will consume exist and pass contrast.

## 7. Golden re-pin verdict

Investigated: **no golden encodes the production partner palette.** `golden.test.ts` (TST-05) pins pipeline *semantic* outcomes (verdict/assignment/dedupe/prev-flag), not colors; `export-render.test.ts` / `coverage-map.test.ts` compute from their own literal input hexes; `partners-colors.test.ts` uses pool *indices*. So the palette swap re-pins **no golden** — the plan's "re-pin export goldens" premise does not map to a color-bearing golden in the current suite. Verified empirically by running the suite after the swap; recorded in ADR-0022. (The only intended test change is the token contrast matrix — TDD, §9.) `CoverageMap.tsx` raw-hex cleanup is deferred to WP-D.

## 8. ADR-0022 (outline)

"Survey visual identity v2 — token swap." Records: palette/type/signature decision; route-line concept rejected; keep-names + two additive tokens (`brandInk`, `borderStrong`) with the full mapping table; warn darkened to `#985E15` with rationale; `prev`→taupe (no purple); partner palette source; the golden-repin verdict (none). Supersedes the "minimal-slate" identity note in `tokens.ts`.

## 9. Test plan (TDD — write first)

In `tests/unit/tokens.test.ts`, before swapping any value:
1. Rewrite the badge-pair contrast block to Survey semantics: Distributed = `[brandInk, brandSoft]`, New = `[info, infoSoft]`, Unmatched = `[warn, warnSoft]`, Removed = `[danger, dangerSoft]`, Matched = `[success, successSoft]`, prev = `[prev, prevSoft]`, neutral = `[text2, surface3]`. Add `brandInk`/paper and `brandInk`/surface (links) assertions.
2. Keep the ink-tier assertions (ink/ink-2/ink-3 on surface + ink-3 on paper) — values change, thresholds don't.
3. The existing structural tests (every key has a `--var` + `--color-` utility; light/dark key parity; PARTNER_PALETTE length 9) automatically cover the two new tokens once added.
These go **red** first, then the `tokens.ts` + `globals.css` swap turns them green.

## 10. Out of scope (deferred, not dropped)

- Badge/primitive component re-skin + on-state=route + badge semantics → **WP-C**.
- AppShell nav regroup, topbar cluster, radii/icon snap → **WP-B**.
- `CoverageMap.tsx` raw-hex removal, map fills/hatch → **WP-D**.
- Per-heading type-scale application + sub-13px chrome purge → per page in **WP-E**.
- Partner ochre-vs-route map legibility check → **WP-D** (kept per approved DIRECTION for now).

## 11. Acceptance / DoD

`pnpm check` green · token contrast test green (Survey matrix, both themes) · fonts load + 16px root render · `/gallery` shows the new tokens/type/palette in both themes · ADR-0022 committed · self-audit (PLAYBOOK §6) checklist printed · pr-reviewer findings addressed · owner gallery walkthrough approved.
