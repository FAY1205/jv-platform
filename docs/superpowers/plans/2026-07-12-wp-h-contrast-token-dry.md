# WP-H — Contrast/token DRY Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development for the pure
> helpers (CON-01). Steps use checkbox (`- [ ]`) syntax. Design doc:
> `docs/superpowers/specs/2026-07-12-wp-h-contrast-token-dry-design.md`.

**Goal:** One shared, reference-pinned WCAG contrast primitive consumed by all five copies; a
theme-flipping `onStatus` token that fixes the dark-mode AA failure on danger/success fills; a
theme-aware tokenized swatch border. One WP-H commit after the owner walkthrough.

**Tech Stack:** TypeScript, Next.js 16, Tailwind v4 (`@theme inline`), ExcelJS, Vitest (jsdom), pnpm.

## Global Constraints

- **PRN-01 / purity:** `contrast.ts` + `render.ts` stay input→value, no DB/fetch/`Date.now`.
- **PRN-12 / SEAM-08:** no hardcoded hex in components; on-fill text + swatch border are tokens; the
  email digest imports the raw value from `tokens.ts` (via `EMAIL_COLORS`).
- **PRN-14 / ADR-0024:** partner swatch stays paired with name + `JV-###`; the **map** `contrastText`
  keeps its 0.179-threshold behavior byte-for-byte (only its luminance source moves).
- **No behavior change** to `lib/contrast.contrastText` / `contrastHalo` outputs (pinned by
  `contrast.test.ts`) or to `render.contrastText`'s AA guarantee (pinned by `export-contrast.test.ts`).
- **Test runner:** `pnpm exec vitest run <files> --no-file-parallelism` (jsdom OOMs in parallel);
  `pnpm typecheck` separately; `pnpm exec eslint <changed files>` only.
- **Commits:** implemented + verified incrementally, committed as a **single WP-H commit** after the
  owner walkthrough (Task 6). Each task ends at a test checkpoint, not a commit.

---

### Task 1: CON-01 — shared WCAG primitive + reference test (TDD)

**Files:** create `tests/unit/wcag.test.ts`; modify `src/lib/contrast.ts`.

**Interfaces produced:**
- `export function relativeLuminance(hex: string): number` — WCAG 2.x; unparseable → `0`; never throws.
- `export function contrastRatio(a: string, b: string): number` — `(Lmax+.05)/(Lmin+.05)`.

- [ ] **Step 1 (RED):** write `tests/unit/wcag.test.ts` against **external** reference values:
  - `contrastRatio("#000000","#FFFFFF")` === 21 (use `toBeCloseTo(21, 5)`)
  - `relativeLuminance("#FFFFFF")` === 1; `relativeLuminance("#000000")` === 0
  - `contrastRatio("#767676","#FFFFFF")` `toBeCloseTo(4.54, 2)`; `contrastRatio("#777777","#FFFFFF")`
    `toBeCloseTo(4.48, 2)` (WebAIM canonical AA-threshold greys)
  - symmetry: `contrastRatio(a,b) === contrastRatio(b,a)`; `relativeLuminance("#fff") === relativeLuminance("#ffffff")`
  - `relativeLuminance("not-a-color") === 0` (never throws)
  - Test names carry the ID, e.g. `it("CON-01: contrastRatio(black,white) is the WCAG max 21:1", …)`.
- [ ] **Step 2 (GREEN):** in `src/lib/contrast.ts`, add `relativeLuminance(hex)` (parse via the
  existing private `parseHex`; `null` → `0`) and `contrastRatio(a,b)`. Rewire `contrastText` to
  `const rgb = parseHex(hex); if (!rgb) return "#111111"; return relativeLuminance(hex) > 0.179 ? …`
  (keeps the invalid→`#111111` guard and the 0.179 threshold). Delete the old array-form
  `relativeLuminance`.
- [ ] **Step 3:** run `wcag.test.ts` + `contrast.test.ts` — both green (contrast.test still passes
  unchanged = proof of no behavior drift).

**Checkpoint:** `pnpm exec vitest run tests/unit/wcag.test.ts tests/unit/contrast.test.ts --no-file-parallelism`

---

### Task 2: CON-01 — migrate the export copy + the 3 test copies to the shared primitive

**Files:** modify `src/modules/export/render.ts`, `tests/unit/{contrast,export-contrast,tokens}.test.ts`.

- [ ] **render.ts:** `import { contrastRatio } from "@/lib/contrast";` Replace the inline
  `relLum`/`ratio` inside `contrastText` with:
  `return contrastRatio("#000000", hex) >= contrastRatio("#FFFFFF", hex) ? "FF000000" : "FFFFFFFF";`
  (behavior identical; ARGB return unchanged).
- [ ] **contrast.test.ts:** delete local `lum`/`ratio`; `import { contrastText, contrastHalo,
  relativeLuminance, contrastRatio } from "@/lib/contrast";` keep `composite` (not luminance math);
  point its `ratio(...)` uses at the shared `contrastRatio`.
- [ ] **export-contrast.test.ts:** delete local `relLum`/`ratio`; import `contrastRatio`; keep
  `argbToHex`; the AA assertions now read `contrastRatio(argbToHex(ink), swatch)`.
- [ ] **tokens.test.ts:** delete local `relLuminance`/`contrastRatio`; import them from `@/lib/contrast`.
- [ ] **Checkpoint:** run all four test files + `export-contrast.test.ts` green; `pnpm typecheck`.
  Confirm grep shows **zero** remaining hand-rolled luminance math outside `src/lib/contrast.ts`.

**Checkpoint:** `pnpm exec vitest run tests/unit/wcag.test.ts tests/unit/contrast.test.ts tests/unit/export-contrast.test.ts tests/unit/tokens.test.ts --no-file-parallelism`

---

### Task 3: CON-02 — `onStatus` token + status-fill AA fix (TDD gate first)

**Files:** modify `src/lib/tokens/tokens.ts`, `src/app/globals.css`, `tests/unit/tokens.test.ts`,
`src/components/Button.tsx`, `src/components/Toast.tsx`.

- [ ] **Step 1 (RED):** add to the `tokens.test.ts` F-17/F-18 block, both themes:
  `expect(contrastRatio(t.onStatus, t.danger)).toBeGreaterThanOrEqual(4.5)` and same for `t.success`.
  Fails to compile (no `onStatus`) → the RED.
- [ ] **Step 2 (GREEN):** `tokens.ts` — add `onStatus: string` to `ColorTokens`; `lightColors.onStatus
  = "#FFFFFF"`; `darkColors.onStatus = "#20160A"`.
- [ ] **Step 3:** `globals.css` — add `--on-status: #ffffff;` to `:root`; `--on-status: #20160a;` to
  **both** dark blocks (`@media prefers-color-scheme:dark :root:not([data-theme=light])` and
  `:root[data-theme="dark"]`); add `--color-on-status: var(--on-status);` to `@theme inline`.
  (`tokens.test`'s "declares a CSS var" + "maps to a Tailwind utility" checks now pass for it.)
- [ ] **Step 4:** repoint the 3 lines:
  - `Button.tsx:25` `danger:` `text-white` → `text-on-status`
  - `Toast.tsx:41` `success:` `text-white` → `text-on-status`
  - `Toast.tsx:42` `danger:` `text-white` → `text-on-status`
- [ ] **Checkpoint:** `tokens.test.ts` green (incl. new AA gate + var/utility checks); `pnpm typecheck`.

---

### Task 4: CON-03 — theme-aware `swatchBorder` token

**Files:** modify `src/lib/tokens/tokens.ts`, `src/app/globals.css`, `tests/unit/tokens.test.ts`,
`src/components/PartnerTag.tsx`, `src/modules/notify/digests.ts`.

- [ ] **tokens.ts:** add `swatchBorder: string` to `ColorTokens`; `lightColors.swatchBorder =
  "rgba(0,0,0,0.18)"`; `darkColors.swatchBorder = "rgba(255,255,255,0.22)"`.
- [ ] **globals.css:** add `--swatch-border: rgba(0,0,0,0.18);` to `:root`; the dark rgba to **both**
  dark blocks. **No** `@theme` mapping (direct-use, like `--scrim`).
- [ ] **tokens.test.ts:** add `swatchBorder` to the Tailwind-utility **exemption** filter alongside
  `scrim` (`.filter((k) => k !== "scrim" && k !== "swatchBorder")`), with a comment: applied directly
  as a border color, not a `bg-/text-/border-` utility. (The "declares a CSS var" check still applies.)
- [ ] **PartnerTag.tsx:** drop `border-black/15` from the className (keep `border`); add
  `borderColor: "var(--swatch-border)"` to the existing inline `style` object.
- [ ] **digests.ts:49:** `border:1px solid rgba(0,0,0,.18)` → `border:1px solid ${C.swatchBorder}`
  (`C = EMAIL_COLORS === lightColors`).
- [ ] **Checkpoint:** `tokens.test.ts` green; `pnpm typecheck`; grep confirms no `border-black/15` and
  no `rgba(0,0,0,.18)` swatch literal remain in `src/`.

---

### Task 5: Full verification

- [ ] `pnpm exec vitest run tests/unit --no-file-parallelism` — full unit suite green (was 510 + WP-G's
  505-line era; expect the new `wcag.test.ts` to add, none to break). Note the pre-existing unrelated
  red `tests/integration/audit-immutability.test.ts` is **not** run here and is out of scope.
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm exec eslint` the changed `src/` files clean.

---

### Task 6: Owner walkthrough (real screenshots) → then commit

- [ ] Throwaway `src/app/gallery/wp-h/page.tsx` (public per `src/proxy.ts`): render, on both a
  `--surface` card and a `--bg` panel, a `<Button variant="danger">`, both Toast tones (mount the
  message markup directly), and a `<PartnerTag>` — with a `?t=light|dark` data-theme setter.
- [ ] `preview_start` name `web` (port 3000); Playwright screenshot light + dark; confirm: dark danger/
  success text is now **near-black** and legible; dark swatch edge reads as a light hairline.
- [ ] **Self-audit (PLAYBOOK §6)** printed in the summary; run **pr-reviewer** + **audit-design-system**
  + **audit-a11y** on the diff; fold in findings (verify each against real code first — findings can
  cite wrong specifics).
- [ ] **Delete** `src/app/gallery/wp-h/`; `rm -rf .playwright-mcp/`; `preview_stop`.
- [ ] Present screenshots to the owner. **On explicit "go"** → one `feat(wp-h): …` commit. **Separate
  explicit "go"** before any push.

## Rollback / risk

- Lowest-risk slice: pure-math dedup (proven no-drift by the untouched `contrast.test`), a
  light-mode-identical token (`onStatus` light = white), and a cosmetic border. No schema, no query,
  no API, no golden. If `render.contrastText`'s import created any boundary lint, fall back to keeping
  its helper local (but grep already proved 31 `src/modules` → `@/lib` imports exist).
