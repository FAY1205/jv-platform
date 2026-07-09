# ADR-0016: Radix UI primitives for interactive components

- **Status:** Accepted (REDESIGN-R3 decision D1)
- **Date:** 2026-07-09
- **Phase / WP:** Phase 2 · REDESIGN-R3 WS-1

## Context

The 2026-07-09 audit found structural accessibility defects in hand-rolled interactive
components: `Modal` has no focus trap and never restores focus to its opener (F-15);
form fields suppress the focus ring (F-16); the only `Tooltip` is gallery-bound (F-64);
checkboxes are re-implemented ad-hoc across five sites (F-62); there is no accessible
date picker, and native `<select>` styling is inconsistent with the design system.
These are the exact problems a headless primitive library solves once, correctly —
keyboard interaction, focus management, ARIA wiring, and portal/overlay behavior — so
we do not re-derive them per component and re-introduce the same class of bug.

## Decision

Adopt **Radix UI** primitives (headless, unstyled) as the interaction layer for
Select, DropdownMenu, Dialog, Checkbox, Tooltip, and Popover. Radix owns behavior and
accessibility; we own presentation via the existing Tailwind design tokens
(`src/lib/tokens`, PRN-12) — no hex/font literals enter component code.

New dependencies:
`@radix-ui/react-select`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-dialog`,
`@radix-ui/react-checkbox`, `@radix-ui/react-tooltip`, `@radix-ui/react-popover`, and
**`react-day-picker`** (the calendar grid behind DatePicker/DateRangePicker, mounted in
a Radix Popover — boring, well-tested, avoids hand-rolling a calendar and its keyboard
model).

`Dialog` is added alongside the existing `Modal`; call sites migrate as their pages are
reworked (WS-2+) and `Modal` is deleted at the end of WS-8. The Radix `Select` is a new
controlled-API component; the existing native `<select>` is retained as `NativeSelect`
for un-migrated pages and removed on the same schedule.

Alternatives considered: **headless alternatives** (Headless UI — smaller primitive set,
no Select/Tooltip/Popover parity; Ark UI — newer, larger surface) — Radix is the most
widely deployed, has the primitives we need, and composes cleanly with Tailwind.
**Keep hand-rolling** — rejected: it is what produced F-14/F-15/F-16/F-62 and does not
scale across the reworked pages.

## Consequences

- The audit's focus-trap / keyboard / focus-ring findings are fixed structurally, not
  patched per component; new interactive components inherit correct behavior.
- Bundle grows by the imported primitives; Radix is tree-shakeable per-package and the
  pages that import them are already the heaviest (mitigated by per-page code-split in
  later WPs).
- Styling stays token-driven; a rebrand remains a token swap, not a component refactor.
- react-day-picker ships a stylesheet — we style via token classes and must ensure no
  raw hex leaks in (PRN-12 is enforced by review).
