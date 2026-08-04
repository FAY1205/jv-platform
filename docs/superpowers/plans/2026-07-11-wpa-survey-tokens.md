# WP-A — Survey Token Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, owner watching) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the app's design tokens, fonts, and partner palette to the approved "Survey" identity — a value-only re-skin on the existing token architecture — with AA verified in both themes.

**Architecture:** Keep every existing token var/key **name**; change only values (owner decision). Two additive tokens the DIRECTION lists but the file lacks — `brandInk` (amber text/links) and `borderStrong` (table rules) — are introduced. Load Fraunces/Hanken Grotesk/IBM Plex Mono via `next/font/google`. Repoint `text-brand`→`text-brand-ink` where brand was used as text (marigold can't be text). Spec: `docs/superpowers/specs/2026-07-11-wpa-survey-tokens-design.md`.

**Tech Stack:** Next 16 / React 19 / Tailwind v4 (`@theme inline`) / vitest. No new dependencies (`next/font` is built-in).

## Global Constraints

- PRN-12: component code consumes semantic tokens only — no hardcoded hex introduced.
- PRN-14: partner color never alone (swatch + name + `JV-###`) — rule unchanged, only tint values change.
- Keep-names: no token key/var is renamed; only values change + two additive tokens (`brandInk`, `borderStrong`).
- No new deps (no ADR needed for `next/font`). ADR-0022 records the identity swap.
- AA: every text/badge pair ≥ 4.5:1 in **both** themes (values pre-verified in the design doc §3).
- Requirement-ID test names (e.g. `it("F-17/F-18: ...")`, `it("SET-02: ...")`).
- **One commit for the whole WP**, gated by PLAYBOOK §6 self-audit + pr-reviewer + owner walkthrough (per session rules). Tasks below end at "verify green / stage", not per-task commits.
- Primary gate: `pnpm run typecheck && pnpm run lint && pnpm run test:unit`. Full `pnpm test` run once at the end; integration/e2e DB failures triaged as the known env blocker.

**Verified value tables live in the design doc §2 (tokens), §4 (type), §5 (palette). This plan references them; where a step edits code it shows the exact code.**

---

### Task 0: Establish green baseline

**Files:** none (read-only).

- [ ] **Step 1:** Run the unit suite before any change.
Run: `pnpm run test:unit`
Expected: PASS (or note any pre-existing failures to distinguish from WP-A effects). Record the tokens/contrast/partner tests as green.

---

### Task 1: Token contrast test → Survey matrix (TDD), then value swap + 2 new tokens

**Files:**
- Test: `tests/unit/tokens.test.ts`
- Modify: `src/lib/tokens/tokens.ts` (interface + lightColors + darkColors)
- Modify: `src/app/globals.css` (`:root`, dark `@media` block, `[data-theme="dark"]` block, `@theme inline`, focus ring)

**Interfaces:**
- Produces: `ColorTokens` gains `brandInk: string` and `borderStrong: string`. All 26 keys resolve to Survey values (design doc §2). CSS vars `--brand-ink`, `--border-strong` + `--color-brand-ink`, `--color-border-strong` added.

- [ ] **Step 1: Rewrite the badge-pair + add brand-ink contrast assertions (RED).**
In `tests/unit/tokens.test.ts`, replace the `pairs` array in the "every Badge variant's text reads on its fill" test and extend the body-text test:

```ts
// body text roles read on their surfaces  (add brand-ink links)
expect(contrastRatio(t.text, t.surface)).toBeGreaterThanOrEqual(4.5);
expect(contrastRatio(t.text2, t.surface)).toBeGreaterThanOrEqual(4.5);
expect(contrastRatio(t.text3, t.surface)).toBeGreaterThanOrEqual(4.5);
expect(contrastRatio(t.text3, t.bg)).toBeGreaterThanOrEqual(4.5);
expect(contrastRatio(t.brandInk, t.bg)).toBeGreaterThanOrEqual(4.5); // amber links on paper
expect(contrastRatio(t.brandInk, t.surface)).toBeGreaterThanOrEqual(4.5);
```

```ts
// Survey badge semantics: text token on its soft fill
const pairs: [string, string][] = [
  [t.brandInk, t.brandSoft], // Distributed (marigold wash, amber-ink text)
  [t.info, t.infoSoft],      // New
  [t.warn, t.warnSoft],      // Unmatched
  [t.danger, t.dangerSoft],  // Removed
  [t.success, t.successSoft],// Matched
  [t.prev, t.prevSoft],      // Previously matched (taupe)
  [t.text2, t.surface3],     // neutral
];
```

- [ ] **Step 2: Run test — verify it fails.**
Run: `pnpm exec vitest run tests/unit/tokens.test.ts`
Expected: FAIL — `t.brandInk` is `undefined` (type error / NaN contrast) and old values won't match new pairs.

- [ ] **Step 3: Add the two tokens to the interface + swap both palettes.**
In `src/lib/tokens/tokens.ts`: add to `ColorTokens` after `brandLine`: `brandInk: string;` and after `borderSoft`: `borderStrong: string;`. Then set `lightColors` and `darkColors` to the design-doc §2 values. Light example (full set per §2):

```ts
export const lightColors: ColorTokens = {
  bg: "#F1F4F3", surface: "#FFFFFF", surface2: "#E9EEEC", surface3: "#DDE5E2",
  border: "#D3DCD9", borderSoft: "#E4E9E7", borderStrong: "#B8C4C0",
  text: "#16242B", text2: "#46565D", text3: "#566268",
  brand: "#E0912B", brandStrong: "#C67D1E", brandSoft: "#FAEFDA",
  brandLine: "#EAD8AE", brandInk: "#8F5416",
  info: "#2E6E93", infoSoft: "#E7EFF4",
  danger: "#B23A2E", dangerSoft: "#F7E4E1",
  warn: "#985E15", warnSoft: "#F7EEDA",
  success: "#2C7A57", successSoft: "#E8F2EC",
  prev: "#6E5C46", prevSoft: "#EFE8DE",
  scrim: "rgba(22,36,43,.4)",
};
```
Dark set (per §2): bg `#10181C`, surface `#17232A`, surface2 `#1E2C33`, surface3 `#26363E`, border `#2A3A41`, borderSoft `#223038`, borderStrong `#3A4D55`, text `#EAF0EE`, text2 `#A9B8BC`, text3 `#85969B`, brand `#F0A63E`, brandStrong `#F6B856`, brandSoft `#2A2417`, brandLine `#4A3A1E`, brandInk `#F0A63E`, info `#5FA0C8`, infoSoft `#1A2A33`, danger `#E06555`, dangerSoft `#301E1B`, warn `#E0973A`, warnSoft `#33291A`, success `#4FB183`, successSoft `#173529`, prev `#CBB89C`, prevSoft `#2A251E`, scrim `rgba(0,0,0,.55)`.

- [ ] **Step 4: Mirror values into globals.css (three blocks + theme map + focus ring).**
Update `:root` (light), the `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` block, and the `:root[data-theme="dark"]` block to the same values (kebab vars: `--brand-ink`, `--border-strong`, etc.). Add to `@theme inline`: `--color-brand-ink: var(--brand-ink);` and `--color-border-strong: var(--border-strong);`. Change the focus ring:

```css
:focus-visible {
  outline: 2px solid var(--brand-strong);
  outline-offset: 2px;
  border-radius: 4px;
}
```

- [ ] **Step 5: Run the token test — verify green.**
Run: `pnpm exec vitest run tests/unit/tokens.test.ts`
Expected: PASS (structural + light/dark parity + contrast, both themes).

---

### Task 2: Fonts (next/font) + 16px root + type scale

**Files:**
- Modify: `src/app/layout.tsx` (font loaders + `<html>` className)
- Modify: `src/app/globals.css` (`--font-*` stacks, `font-size: 16px`, line-heights, scale vars)
- Test: `tests/unit/tokens.test.ts` (add a type-foundation guard)

**Interfaces:**
- Produces: `<html>` carries `--font-fraunces`, `--font-hanken`, `--font-plex-mono` CSS vars; `globals.css` maps `--font-display/-sans/-mono` onto them with fallbacks; root is 16px.

- [ ] **Step 1: Add a foundation guard test (RED).**
In `tests/unit/tokens.test.ts`, add to the `DSN-01/SEAM-08` describe:

```ts
it("DSN-02: root is 16px and the three next/font faces are wired", () => {
  expect(globalsCss).toContain("font-size: 16px");
  expect(globalsCss).toContain("--font-fraunces");
  expect(globalsCss).toContain("--font-hanken");
  expect(globalsCss).toContain("--font-plex-mono");
});
```

- [ ] **Step 2: Run — verify it fails.**
Run: `pnpm exec vitest run tests/unit/tokens.test.ts -t DSN-02`
Expected: FAIL (`font-size: 14px`, no font vars yet).

- [ ] **Step 3: Wire next/font in layout.tsx.**

```tsx
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";

const fraunces = Fraunces({
  subsets: ["latin"], display: "swap", variable: "--font-fraunces",
  fallback: ["ui-serif", "Iowan Old Style", "Palatino Linotype", "Georgia", "serif"],
});
const hanken = Hanken_Grotesk({
  subsets: ["latin"], display: "swap", variable: "--font-hanken",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-plex-mono",
  fallback: ["SF Mono", "Cascadia Code", "ui-monospace", "Roboto Mono", "monospace"],
});
```
Apply on `<html>`: `className={\`h-full antialiased ${fraunces.variable} ${hanken.variable} ${plexMono.variable}\`}`. Update the DSN-02 comment to reflect real webfonts.

- [ ] **Step 4: Point globals.css font roles at the loaded faces + set 16px + scale.**

```css
--font-display: var(--font-fraunces), ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif;
--font-sans: var(--font-hanken), system-ui, -apple-system, "Segoe UI", sans-serif;
--font-mono: var(--font-plex-mono), "SF Mono", "Cascadia Code", ui-monospace, "Roboto Mono", monospace;
/* 1.2 scale (adoption per-page in WP-E) */
--step--1: .813rem; --step-0: 1rem; --step-1: 1.2rem; --step-2: 1.44rem;
--step-3: 1.728rem; --step-4: 2.074rem; --step-5: 2.488rem;
```
Change `html { font-size: 14px; }` → `16px`. Set `body { line-height: 1.55; }`. Add base heading rule:

```css
h1, h2, h3, h4 { line-height: 1.15; text-wrap: balance; }
```

- [ ] **Step 5: Run the guard test — verify green.**
Run: `pnpm exec vitest run tests/unit/tokens.test.ts -t DSN-02`
Expected: PASS.

---

### Task 3: Partner palette swap (Survey map tints)

**Files:**
- Modify: `src/lib/tokens/tokens.ts` (`PARTNER_PALETTE`, `PARTNER_SWATCHES`)
- Test: `tests/unit/tokens.test.ts` (extend SET-02)

**Interfaces:**
- Produces: 9-partner roster keeps names, takes 9 Survey tints; `PARTNER_SWATCHES` = those 9 + ochre + 10 extended tints (design doc §5). Consumed unchanged by `seed.ts` and `pickPartnerColor`.

- [ ] **Step 1: Extend SET-02 test (RED).**

```ts
it("SET-02: the swatch pool is a superset of the roster and all unique", () => {
  const rosterHexes = PARTNER_PALETTE.map((p) => p.hex.toLowerCase());
  const pool = PARTNER_SWATCHES.map((c) => c.toLowerCase());
  for (const h of rosterHexes) expect(pool).toContain(h);
  expect(new Set(pool).size).toBe(pool.length);
  expect(PARTNER_SWATCHES.length).toBeGreaterThanOrEqual(18);
});
```
(Requires importing `PARTNER_SWATCHES` in the test.)

- [ ] **Step 2: Run — verify it fails.**
Run: `pnpm exec vitest run tests/unit/tokens.test.ts -t SET-02`
Expected: FAIL (current pool has duplicate-free legacy tints but the new assertion imports `PARTNER_SWATCHES` not yet imported / length check may pass — confirm it fails on the not-yet-imported symbol, then on values after import).

- [ ] **Step 3: Swap the palettes (design doc §5 values).**
`PARTNER_PALETTE`: keep the 9 names, set hexes to clay `#B4623F`, sage `#6E8B5E`, slate-blue `#5B7A9E`, plum `#8A5A78`, teal `#3E8C8A`, rust `#A65A34`, moss `#57794C`, denim `#47688E`, brick `#9E4B45` (in roster order). `PARTNER_SWATCHES`: `[...PARTNER_PALETTE.map(p=>p.hex), "#C79A3E" /*ochre*/, "#3E6B52", "#7A3B45", "#2F6E7A", "#8A7B57", "#6B4A66", "#6E7A3E", "#B08A52", "#3E5A7A", "#B5764C", "#5E9E8E"]` with a comment naming each tint.

- [ ] **Step 4: Run SET-02 + partners-colors — verify green.**
Run: `pnpm exec vitest run tests/unit/tokens.test.ts tests/unit/partners-colors.test.ts`
Expected: PASS.

---

### Task 4: AA-preserving repoints (text-brand → text-brand-ink)

**Files (modify — replace `text-brand` used as *text* with `text-brand-ink`; leave `bg-brand*`, `border-brand*`, `hover:border-brand-line` untouched):**
`src/app/coverage/page.tsx`, `src/app/account/password/page.tsx`, `src/app/forgot/page.tsx`, `src/app/reset/page.tsx`, `src/app/upload/page.tsx`, `src/app/imports/page.tsx`, `src/app/imports/[ref]/page.tsx`, `src/app/dev/emails/emails-view.tsx`, `src/app/settings/data/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/leads/leads-view.tsx`, `src/components/Tabs.tsx`, `src/components/StatusSelect.tsx`, `src/app/settings/settings-nav.tsx`.

**Interfaces:** consumes `--color-brand-ink` (Task 1). No new symbols.

- [ ] **Step 1: Repoint each text usage.** Examples:
  - `text-brand hover:underline` → `text-brand-ink hover:underline` (links: coverage:89, account/password:17, forgot:52, reset:66/73, upload:123, imports:63, dev/emails:138, settings/data:97).
  - `dashboard/page.tsx:47` Stat tone `"text-brand"` → `"text-brand-ink"`; `:190` closed count `text-brand` → `text-brand-ink`.
  - `leads-view.tsx`: filter chip active `text-brand` → `text-brand-ink` (177), row hover `group-hover:text-brand` → `group-hover:text-brand-ink` (241).
  - `imports/[ref]/page.tsx:336` ZIP `text-brand` → `text-brand-ink`.
  - `Tabs.tsx:42` active `"text-brand border-brand"` → `"text-brand-ink border-brand"` (border stays brand).
  - `StatusSelect.tsx:18` `"bg-brand-soft text-brand"` → `"bg-brand-soft text-brand-ink"`.
  - `settings-nav.tsx:45` `"bg-brand-soft font-semibold text-brand-strong"` → `"...text-brand-ink"`.

- [ ] **Step 2: Verify no brand-as-text remains.**
Run: `pnpm exec grep -rnE "text-brand\b" src` (Bash) — expect **no** matches (only `text-brand-ink`, `text-brand-strong` if any legit non-text use, `bg-brand*`, `border-brand*` remain). Manually confirm any survivor is a deliberate non-text/high-contrast case; otherwise repoint.

- [ ] **Step 3: Typecheck + lint.**
Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS (class-string changes are type-safe; lint clean).

---

### Task 5: ADR-0022 + header comment + full verification (golden no-repin)

**Files:**
- Create: `docs/adr/0020-survey-visual-identity.md`
- Modify: `src/lib/tokens/tokens.ts` (header comment: replace the "Minimal-slate identity (2026-07)" note with the Survey note referencing ADR-0022)

- [ ] **Step 1: Write ADR-0022** per design doc §8 (context, decision, keep-names + mapping table, warn `#985E15` rationale, prev→taupe/no-purple, partner source, golden-repin verdict = none, supersedes the slate note). Follow the existing ADR format (see `docs/adr/0018-remove-campaign-recodes.md`).

- [ ] **Step 2: Update the tokens.ts header comment** to name the Survey identity + ADR-0022 (remove the stale slate description).

- [ ] **Step 3: Run the full unit suite — confirm golden unaffected + everything green.**
Run: `pnpm run test:unit`
Expected: PASS, **including** `golden.test.ts` (TST-05) unchanged — proves the palette swap re-pins no golden (design doc §7). Record this as the empirical verdict for ADR-0022.

- [ ] **Step 4: Full gate.**
Run: `pnpm run typecheck && pnpm run lint && pnpm run test:unit`
Expected: PASS. Then `pnpm test` (full) once; triage any integration/e2e failure as the known DB/env blocker (not token-related).

---

## Post-plan (session-level, not per-task commits)

1. **PLAYBOOK §6 self-audit** — print the filled checklist in the summary.
2. **pr-reviewer agent** on the WP-A diff; fix findings.
3. **Owner walkthrough** — `/gallery` in both themes for sign-off.
4. **Single WP-A commit** with requirement-ID test names, after 1–3 pass.

## Self-Review (against spec)

- **Spec coverage:** §2 tokens → Task 1; §4 type → Task 2; §5 palette → Task 3; §6 repoints → Tasks 1 (focus) + 4 (text); §7 golden verdict → Task 5.3; §8 ADR → Task 5.1; §9 test plan → Tasks 1–3 tests; §3 matrix → verified pre-plan (derive.mjs) and enforced by Task 1 test. All covered.
- **Placeholders:** none — every code step shows exact values/classes.
- **Type consistency:** `brandInk`/`borderStrong` added to `ColorTokens` (Task 1) and consumed as `--color-brand-ink`/`text-brand-ink` (Tasks 1,4) and `--color-border-strong` (Task 1); names consistent throughout.
