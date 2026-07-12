# WP-H — Contrast/token DRY (shared WCAG primitive · status-fill AA · swatch border)

**Status:** design · **Branch:** phase-2/distribution · **Date:** 2026-07-12
**Inputs:** design-menu slice **C** (app-wide cleanups) · current code: `src/lib/contrast.ts`,
`src/modules/export/render.ts`, `src/components/{Button,Toast,PartnerTag}.tsx`,
`src/lib/tokens/tokens.ts`, `src/app/globals.css`, `src/modules/notify/digests.ts`,
`tests/unit/{contrast,export-contrast,tokens}.test.ts`
**Owner calls (2026-07-12):**
1. **Full dedup + reference test** — all copies of the WCAG math collapse to one shared primitive,
   whose correctness is pinned by a new `wcag.test.ts` against **external WebAIM reference ratios**
   (so no test validates a function against itself).
2. **Theme-aware swatch border** — the partner-swatch hairline flips to a subtle light edge in dark
   mode (fixes the muddy edge on dark cards), unified across PartnerTag + the email digest.

---

## 1. Context & problem

Three independent cleanups, one theme (color math + tokens), one commit:

- **C1 (CON-01) — the WCAG math is copied 5×.** Verified by grep, not by the brief (which said 3):
  `src/lib/contrast.ts` (`relativeLuminance([r,g,b])`), `src/modules/export/render.ts` (inline
  `relLum`/`ratio` inside `contrastText`), and **three** test files (`tokens.test.ts`
  `relLuminance`/`contrastRatio`; `contrast.test.ts` `lum`/`ratio`; `export-contrast.test.ts`
  `relLum`/`ratio`). Same formula, five hand-rolled copies — a drift hazard and PRN-12-adjacent smell.

- **C2 (CON-02) — status fills fail WCAG AA in dark mode.** Reproduced against the *real* current
  tokens (not the brief's stale hexes):

  | fill | white text | verdict |
  |---|---|---|
  | light `--danger` `#B23A2E` | 5.94:1 | PASS |
  | light `--success` `#2C7A57` | 5.21:1 | PASS |
  | **dark `--danger` `#E06555`** | **3.41:1** | **FAIL** |
  | **dark `--success` `#4FB183`** | **2.64:1** | **FAIL** |

  `text-white` is hardcoded on exactly **3 lines** — `Button.tsx:25` (danger), `Toast.tsx:41`
  (success), `Toast.tsx:42` (danger). In **both** dark cases black wins (6.16 / 7.95); in **both**
  light cases white wins. So one **theme-flipping** token fixes all four.

- **C3 (CON-03) — the partner-swatch hairline is duplicated + wrong in dark.** `PartnerTag.tsx:25`
  uses `border-black/15`; the email digest (`digests.ts:49`) inlines `rgba(0,0,0,.18)` — two values
  (.15 / .18) for one concept. And `border-black/15` on a dark card gives a muddy edge (a black
  hairline blending into a dark surface).

## 2. Non-negotiables that bind this work

- **PRN-01 / purity** — `contrast.ts` and `render.ts` stay pure (hex → number/string; no DB/fetch/
  `Date.now`). The shared primitive is pure math.
- **PRN-12 / SEAM-08** — no hardcoded hex in component code; swatch-border and on-fill text become
  **semantic tokens**. The email digest is an off-CSS consumer (cannot read CSS vars) → it imports
  the **raw value** from `tokens.ts`, exactly as it already imports `lightColors`/`emailFonts`.
- **PRN-14** — the partner swatch stays paired with name + `JV-###` everywhere; the border change is
  cosmetic and touches neither the pairing nor `contrastText`'s color pick.
- **ADR-0024** — the **map** label pick (`lib/contrast.contrastText`, `#111111` via a 0.179
  luminance *threshold*) is a documented sub-AA carve-out and **must not change behavior**. Only its
  luminance *source* moves to the shared primitive.
- **WP-G AA fix** — the **export** label pick (`render.contrastText`, pure-black ARGB via a true
  black-vs-white *ratio*) must keep its AA guarantee on all 20 tints. Only its `ratio` helper moves
  to the shared primitive.
- **DM-08 / goldens** — no rules-snapshot or export-bytes golden is affected (partner colors are not
  a rules input; export determinism is verified semantically). Nothing re-pins.

## 3. The two `contrastText` functions stay separate (critical)

`lib/contrast.contrastText` and `render.contrastText` are **deliberately different policies** and are
**not** merged — only the low-level math (`relativeLuminance`, `contrastRatio`) is shared:

| | `lib/contrast.contrastText` | `render.contrastText` |
|---|---|---|
| consumer | on-fill **map** labels (`CoverageMap`) | **export** row/legend ink |
| policy | 0.179 luminance **threshold** | black-vs-white **ratio** (max contrast) |
| returns | `"#111111"` \| `"#ffffff"` | `"FF000000"` \| `"FFFFFFFF"` (ARGB) |
| bar | sub-AA carve-out (ADR-0024) | AA required (WP-G) |

`contrast.test.ts` already proves the threshold agrees with the ratio-optimal pick on every real
swatch, so behavior is unchanged either way — we keep the threshold to avoid touching ADR-0024.

## 4. C1 — the shared WCAG primitive (CON-01)

New pure exports, added to the existing `src/lib/contrast.ts` (its established home; `CoverageMap`
already imports from it — no new module needed):

```ts
// src/lib/contrast.ts
export function relativeLuminance(hex: string): number   // WCAG 2.x; invalid → 0 (never throws)
export function contrastRatio(a: string, b: string): number   // (Lmax+.05)/(Lmin+.05)
```

- `parseHex` stays private (handles 3- and 6-digit, tolerant). `relativeLuminance` parses via it;
  unparseable → `0` (consistent with the "never throws, unknown → darkest" house style). `contrastText`
  keeps its own `parseHex` guard so its **invalid → `#111111`** fallback is byte-identical.
- `contrastText` (map) and `contrastHalo` are rewired to call `relativeLuminance`; **outputs
  unchanged** (0.179 threshold preserved; pinned by `contrast.test.ts`).
- `render.contrastText` becomes a thin wrapper:
  `contrastRatio("#000000", hex) >= contrastRatio("#FFFFFF", hex) ? "FF000000" : "FFFFFFFF"`.
  `render.ts` imports `contrastRatio` from `@/lib/contrast` (31 `src/modules` files already import
  `@/lib` — no boundary violation; `contrast.ts` is pure, so `render.ts` stays deterministic).
- **All three test copies** drop their local math and import `relativeLuminance`/`contrastRatio`.
  Test-only helpers that are *not* luminance math stay local: `composite` (sRGB compositing,
  `contrast.test`) and `argbToHex` (`export-contrast.test`).

**Why this is not circular** (the owner's dedup concern): a new `tests/unit/wcag.test.ts` pins the
primitive to **external** truth — values you can look up on WebAIM, not re-derived with the same
formula:

- `contrastRatio("#000000","#FFFFFF") === 21` (exact)
- `relativeLuminance("#FFFFFF") === 1`, `relativeLuminance("#000000") === 0` (exact)
- `contrastRatio("#767676","#FFFFFF")` ≈ 4.54 and `contrastRatio("#777777","#FFFFFF")` ≈ 4.48 —
  WebAIM's canonical "just passes / just fails AA on white" greys
- symmetry: `contrastRatio(a,b) === contrastRatio(b,a)`; `#fff` shorthand === `#ffffff`;
  invalid input → luminance `0` (documented, never throws)

Because the primitive is independently anchored, every consumer (production *and* tests) can share it
without a test grading a function against itself.

## 5. C2 — status-fill AA fix (CON-02)

New **theme-flipping** semantic token `onStatus` — near-white ink in light, near-black in dark, sized
so the same token clears AA on **both** the danger and success fills in **both** themes:

| token | light | dark |
|---|---|---|
| `onStatus` → `--on-status` | `#FFFFFF` | `#20160A` |

Verified AA (≥4.5): light white on danger 5.94 / success 5.21; dark `#20160A` on danger **5.22** /
success **6.73**. (`#20160A` reuses the app's existing "near-black ink on a colored fill" value —
the same literal `--brand-contrast` uses — but as an independent token; `--brand-contrast` itself
**cannot** be reused because it is theme-invariant and fails in light: `#20160A` on light danger =
3.00.) In light mode the value is literally white → **no visual change**; only dark flips.

- `onStatus` is a full color token → `--on-status` in all three theme blocks **+**
  `--color-on-status: var(--on-status)` in `@theme` → Tailwind utility `text-on-status`.
- Repoint the 3 lines: `Button` danger and `Toast` success/danger `text-white` → `text-on-status`.
  (Primary Button `text-brand-contrast` and Toast `default` `text-surface` are already correct —
  untouched.)
- New AA gate in `tokens.test.ts` (extends the F-17/F-18 SC 1.4.3 family):
  `contrastRatio(t.onStatus, t.danger) >= 4.5` and `>= 4.5` for `t.success`, both themes.

## 6. C3 — theme-aware swatch border (CON-03)

New **direct-use** token `swatchBorder` — a hairline over the partner color, dark edge in light,
light edge in dark (mirrors `scrim`'s pattern: a CSS var + a raw `tokens.ts` value, **no** `@theme`
utility, applied directly):

| token | light | dark |
|---|---|---|
| `swatchBorder` → `--swatch-border` | `rgba(0,0,0,0.18)` | `rgba(255,255,255,0.22)` |

- Unifies the two duplicated values to **one** source; light value adopts `.18` (matches every
  mockup) over PartnerTag's old `.15`.
- **PartnerTag** keeps the `border` (1px) utility, drops `border-black/15`, and sets the color inline:
  `style={{ …, borderColor: "var(--swatch-border)" }}` — no ugly `border-swatch-border` utility.
- **Email digest** (`digests.ts:49`) replaces the literal `rgba(0,0,0,.18)` with `${C.swatchBorder}`
  where `C = EMAIL_COLORS`. `EMAIL_COLORS === lightColors` (whole object), so adding `swatchBorder` to
  `lightColors` makes it flow automatically — **no change to `email-template.ts`**. Emails are
  light-only → always the light value, correct. `digests.ts:49` is the **only** inline-HTML swatch in
  the notify module (grep-verified).
- `swatchBorder` joins `scrim` in the `tokens.test.ts` Tailwind-utility **exemption** (both are
  applied directly, not as `bg-/text-/border-` utilities); it is **not** exempt from the "declares a
  CSS var" check. No AA gate — a decorative hairline is not text.

## 7. Files touched

| File | Change |
|---|---|
| `src/lib/contrast.ts` | + `relativeLuminance(hex)`, `contrastRatio(a,b)`; rewire `contrastText`/`contrastHalo` |
| `src/modules/export/render.ts` | `contrastText` → thin wrapper over imported `contrastRatio` |
| `src/lib/tokens/tokens.ts` | + `onStatus`, `swatchBorder` to `ColorTokens`/`lightColors`/`darkColors` |
| `src/app/globals.css` | + `--on-status`, `--swatch-border` in 3 theme blocks; + `--color-on-status` in `@theme` |
| `src/components/Button.tsx` | danger `text-white` → `text-on-status` |
| `src/components/Toast.tsx` | success/danger `text-white` → `text-on-status` |
| `src/components/PartnerTag.tsx` | `border-black/15` → inline `borderColor: var(--swatch-border)` |
| `src/modules/notify/digests.ts` | swatch rgba (L49) → `${C.swatchBorder}` (via `EMAIL_COLORS`) |
| `tests/unit/wcag.test.ts` | **NEW** — reference-value gate for the primitive |
| `tests/unit/contrast.test.ts` | drop local `lum`/`ratio`, import shared |
| `tests/unit/export-contrast.test.ts` | drop local `relLum`/`ratio`, import shared |
| `tests/unit/tokens.test.ts` | drop local math, import shared; + CON-02 AA gate; + `swatchBorder` utility-exemption |

## 8. Out of scope (WP candidates)

- Upgrading the **map** `contrastText` from threshold → ratio pick (no behavior change on real
  swatches; ADR-0024 governs).
- `border-black/15` audit elsewhere (grep shows PartnerTag is the only component using it).
- DSN-11 type-scale tokens; PartnerTag `size="sm"` sub-13px; PageHeader subtitle slot (other menu
  slices).

## 9. Verification

- `pnpm exec vitest run tests/unit/wcag.test.ts tests/unit/contrast.test.ts
  tests/unit/export-contrast.test.ts tests/unit/tokens.test.ts --no-file-parallelism` green;
  full unit suite green serially; `pnpm typecheck`; eslint the changed files.
- **Owner walkthrough (real screenshots):** a throwaway `src/app/gallery/wp-h/` route rendering
  Button danger + Toast success/danger + PartnerTag on light and dark surfaces, screenshotted both
  themes via Playwright; delete before commit. Confirms the dark status text is now near-black and
  the dark swatch edge reads.
- Self-audit (PLAYBOOK §6) + agents on the diff: **pr-reviewer** (always), **audit-design-system**
  (tokens/primitives), **audit-a11y** (contrast). No scoped queries or API contracts touched, so
  audit-tenancy / audit-api-contract are N/A.
