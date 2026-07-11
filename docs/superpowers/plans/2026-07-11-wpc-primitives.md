# WP-C — Primitive Re-skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish the Survey primitive re-skin — AA-correct marigold-fill text (ink), AA focus rings (`brand-strong`, closing WP-A F-3), route on-state marks, and the sub-13px chrome purge in touched primitives — with `/gallery` showing the state matrix.

**Architecture:** Mechanical token/class swaps on the component library (`src/components/*`) + a scripted focus-ring repoint; no behavior changes. TDD anchor = token contrast assertions. Spec: `docs/superpowers/specs/2026-07-11-wpc-primitives-design.md`.

**Tech Stack:** React 19 · Tailwind v4 · Radix · vitest.

## Global Constraints

- PRN-12: tokens only — no raw hex introduced. **[Superseded by ADR-0023, owner-approved in-build:** marigold-fill text = **`--brand-contrast`** #20160A (the TDD anchor showed `text-text` is 1.78:1 in dark); focus ring = **`ring-brand-ink`** + global outline `--brand-ink` (brand-strong was 2.99:1 on paper).**]**
- No admin page body touched (WP-E). The focus-ring swap touches 3 chrome/error pages (`settings/appearance`, `global-error`, `not-found`) with a one-token AA fix only.
- Maps untouched (WP-D).
- **Run vitest SERIALLY and one instance at a time** (`--no-file-parallelism`) — concurrent jsdom runs OOM this machine.
- One commit for the WP, gated by §6 self-audit + pr-reviewer + `/audit frontend` + owner walkthrough.
- Gate: `pnpm run typecheck && pnpm run lint && pnpm exec vitest run tests/unit --no-file-parallelism`.

---

### Task 1: Token contrast anchors (TDD guard)

**Files:** Test `tests/unit/tokens.test.ts`.

- [ ] **Step 1:** In the `F-17/F-18` contrast describe, add (inside the existing `for (const [theme, t] of ...)` loop):

```ts
it(`${theme}: ink reads on the marigold fill; the focus ring meets non-text AA`, () => {
  expect(contrastRatio(t.text, t.brand)).toBeGreaterThanOrEqual(4.5); // Button/checkbox ink text
  expect(contrastRatio(t.brandStrong, t.surface)).toBeGreaterThanOrEqual(3); // focus ring on surface
  expect(contrastRatio(t.brandStrong, t.bg)).toBeGreaterThanOrEqual(3);      // focus ring on paper
});
```

- [ ] **Step 2:** Run `pnpm exec vitest run tests/unit/tokens.test.ts` → PASS (the WP-A values already satisfy these; the test now *guards* the button-text + focus-ring contract so a future token edit can't silently break it).

---

### Task 2: Button primary text → ink

**Files:** `src/components/Button.tsx`; `src/app/global-error.tsx`; `src/app/not-found.tsx`.

- [ ] **Step 1:** In `Button.tsx`, change the `primary` variant:
```ts
  primary: "bg-brand text-text border-brand hover:bg-brand-strong",
```
(from `text-white`). Leave `secondary`/`ghost`/`danger` unchanged.

- [ ] **Step 2:** In `global-error.tsx:22` and `not-found.tsx:17`, the inline marigold button `bg-brand … text-white …` → `text-text` (same AA fix; these pages have their own button, not the primitive).

- [ ] **Step 3:** `pnpm run typecheck` → clean.

---

### Task 3: Checkbox — AA checkmark + focus ring

**Files:** `src/components/Checkbox.tsx`.

- [ ] **Step 1:** Checkmark indicator ink (checked fill is already `bg-brand` = route):
```tsx
<RadixCheckbox.Indicator className="text-text">
```
(from `text-white`).

- [ ] **Step 2:** Ring `focus-visible:ring-brand/50` → `focus-visible:ring-brand-strong` (also covered by the Task 4 script, but stated here for the component's completeness).

---

### Task 4: Focus-ring repoint (closes WP-A F-3)

**Files (scripted):** `Input.tsx`, `Textarea.tsx`, `Select.tsx`, `NativeSelect.tsx`, `StatusSelect.tsx`, `DatePicker.tsx`, `DateRangePicker.tsx`, `Checkbox.tsx`, `Dialog.tsx`, `RowOpenButton.tsx`, `Pagination.tsx`, `NotificationBell.tsx`, `src/app/settings/appearance/page.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`.

- [ ] **Step 1:** Run this repoint (ordered so `ring-brand-strong` is never double-touched):

```js
// scratchpad/ring-repoint.mjs
import { readFileSync, writeFileSync } from "node:fs";
const files = ["src/components/Input.tsx","src/components/Textarea.tsx","src/components/Select.tsx","src/components/NativeSelect.tsx","src/components/StatusSelect.tsx","src/components/DatePicker.tsx","src/components/DateRangePicker.tsx","src/components/Checkbox.tsx","src/components/Dialog.tsx","src/components/RowOpenButton.tsx","src/components/Pagination.tsx","src/components/NotificationBell.tsx","src/app/settings/appearance/page.tsx","src/app/global-error.tsx","src/app/not-found.tsx"];
let n = 0;
for (const rel of files) {
  const p = "C:/Personal_Applications/JV_Leads/" + rel;
  const before = readFileSync(p, "utf8");
  let a = before.replaceAll("ring-brand-line", "ring-brand-strong");
  a = a.replaceAll("ring-brand/50", "ring-brand-strong");
  a = a.replace(/ring-brand(?![-/\w])/g, "ring-brand-strong");            // bare full-opacity rings
  a = a.replace(/focus-visible:border-brand(?![-\w])/g, "focus-visible:border-brand-strong");
  if (a !== before) { writeFileSync(p, a); n++; console.log("  " + rel); }
}
console.log("repointed " + n + " files");
```

- [ ] **Step 2:** Verify no failing ring remains: `pnpm exec grep -rnE "ring-brand(/50|-line|\b)" src` → only `ring-brand-strong` may match its own substring; confirm **no** `ring-brand/50`, `ring-brand-line`, or bare `ring-brand` remains:
`pnpm exec grep -rnE "ring-brand(/50|-line)([^-]|$)|ring-brand([^-/\w]|$)" src` → expect no matches.

- [ ] **Step 3:** `pnpm run typecheck` → clean.

---

### Task 5: Stat + Table sub-13px purge + Th rule

**Files:** `src/components/Stat.tsx`, `src/components/Table.tsx`.

- [ ] **Step 1:** `Stat.tsx`: label `text-[.68rem]` → `text-[0.8125rem]`; delta `text-[.7rem]` → `text-[0.8125rem]`.
- [ ] **Step 2:** `Table.tsx` `Th`: `text-[.65rem]` → `text-[0.8125rem]`; and the header rule `border-b border-border` → `border-b border-border-strong`.
- [ ] **Step 3:** `pnpm run typecheck` → clean.

---

### Task 6: Gallery state matrix (verify + fill)

**Files:** `src/app/gallery/page.tsx` (only if a gap is found).

- [ ] **Step 1:** Read `gallery/page.tsx`; confirm it renders each primitive across its states (Button variants×sizes + loading + disabled; all Badge variants; fields default+disabled; Toast triggers; Dialog; Skeleton; EmptyState; a partner-accented Table row with right-aligned mono numerics; Stat; checkbox on-state). The reskin shows automatically (live components); add a state block ONLY where genuinely missing. Keep to the gallery file (no page bodies).
- [ ] **Step 2:** `pnpm run typecheck` → clean.

---

### Task 7: Full verification

- [ ] **Step 1:** `pnpm run typecheck && pnpm run lint` → typecheck clean, lint 0 errors (pre-existing warnings only).
- [ ] **Step 2:** `pnpm exec vitest run tests/unit --no-file-parallelism > <scratchpad>/wpc-unit.txt 2>&1; echo EXIT=$?` (single instance) → confirm all green incl. the new contrast assertions. Read the summary from the file.

---

## Post-plan (session-level)

1. PLAYBOOK §6 self-audit — printed.
2. pr-reviewer on the diff; fix findings.
3. `/audit frontend` on the diff (WP-C-specific); triage findings.
4. Owner gallery walkthrough.
5. Single WP-C commit after 1–4.

## Self-Review (against spec)

- §3 Button → Task 2; Checkbox → Task 3; focus rings → Task 4; Stat/Table → Task 5. §4 gallery → Task 6. §5 TDD → Task 1. All covered.
- Placeholders: none — exact class swaps + the repoint script inline.
- Type consistency: `text-text`/`ring-brand-strong`/`border-brand-strong`/`border-border-strong` are all existing tokens (brandStrong + borderStrong added in WP-A).
