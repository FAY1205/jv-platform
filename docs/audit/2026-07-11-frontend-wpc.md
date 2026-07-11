# /audit frontend — WP-C primitive re-skin (2026-07-11)

**Scope:** WP-C uncommitted diff on `phase-2/distribution` (base `5d67bac`). **Agents:** pr-reviewer, audit-design-system, audit-a11y (the two relevant frontend specialists for a token/primitive AA reskin; frontend-arch / frontend-perf / ux-flows had no surface in this diff — no data-layer, bundle, or async-flow change — recorded skipped). Raw outputs in `raw/2026-07-11-frontend-wpc/`. Served-build/axe was unavailable (browser-preview env blocker) → static contrast-math analysis; all three independently recomputed the WCAG numbers and agree.

## Executive summary

The WP-C token math is sound and independently verified by all three agents: `--brand-contrast` (#20160A) reads 6.99:1 light / 8.67:1 dark on the marigold fill; the `--brand-ink` focus ring clears ≥3:1 on both surface and paper in both themes (the superseded `brand-strong` was 2.987:1 on paper — confirmed). Token parity across `tokens.ts` + all 3 `globals.css` blocks + `@theme` is exact; the ring repoint is complete with no over-match onto non-focus `border-brand` states.

The high-signal finding — flagged independently by **all three** agents — was that WP-C's own AA fix was **incomplete**: the identical "white text on `bg-brand`" defect survived in `DatePicker`/`DateRangePicker` selected days and the `NotificationBell` unread badge, inside files this diff already touched. **Fixed.** Two more real items from audit-design-system (three field primitives' `focus:border-brand` not migrated; Checkbox missing a hover state) were **fixed**. A pre-existing, out-of-scope AA bug (danger/success white text fails in dark mode) is **tracked** as a follow-up.

## Findings → resolution

| # | Sev | Finding | Resolution |
|---|---|---|---|
| pr F-2 / ds F-1 / a11y F-1,F-2 | High | `text-white` on `bg-brand` in DatePicker/DateRangePicker + NotificationBell badge (~2.5:1 light / 2.05:1 dark) | **Fixed** → `text-brand-contrast` |
| ds F-2 | Med | `Input`/`NativeSelect`/`Textarea` `focus:border-brand` not migrated (2.55:1 light) | **Fixed** → `focus:border-brand-ink` |
| ds F-4 | Low | `Checkbox` had no hover state (DSN-03) | **Fixed** → state-scoped hover |
| pr F-1 | High (governance) | Shipped `brand-contrast`/`brand-ink` diverged from the approved doc (`text-text`/`brand-strong`) w/o ADR | **Fixed** → ADR-0023 + spec/plan annotated (pivot was owner-approved in-build + math-forced) |
| pr F-4 | Low | New contrast test lacked a SPEC id | **Fixed** → `DSN-10/PRN-14` in the title |
| a11y F-3 | Med | danger/success `text-white` fails AA in **dark** (3.41 / 2.64:1) — Button + Toast | **Tracked** → spawned "status-fill contrast pass" (pre-existing, needs a themed family fix) |
| pr F-3 | Med | 3 page-body `bg-brand`/`text-white` CTAs (dashboard/imports/profile) | **Deferred → WP-E** (page bodies) |
| ds F-3 | Low | `NotificationBell` absent from `/gallery` | WP candidate (needs a mock-query harness) |
| ds EXTERNAL-GAP | — | type-scale steps not mapped into `@theme` (`text-[0.8125rem]` repeated) | Spec candidate: propose `DSN-11` (map steps → `text-step-*`) |
| a11y F-4 | Low | sub-13px leftovers (NotificationBell micro-text, Stat foot `text-xs`) | Accepted — scoped commit to Stat/Table Th; no WCAG SC failed |

## Verified after fixes
`pnpm run typecheck` clean · `pnpm run lint` 0 errors · `pnpm exec vitest run tests/unit --no-file-parallelism` = **76 files / 429 tests green**. Token contrast test guards `brandContrast/brand ≥ 4.5` and `brandInk/{surface,bg} ≥ 3`, both themes.
