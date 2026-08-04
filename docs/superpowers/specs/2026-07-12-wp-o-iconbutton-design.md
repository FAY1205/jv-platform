# WP-O — `IconButton` primitive (cleanup menu slice B1)

**Date:** 2026-07-12
**Branch:** phase-2/distribution
**Tier:** B (new shared primitive; touches shared chrome + a11y target size)

## Problem

WP-N bumped the four shared **chrome icon buttons** to a 44px tap box (`h-11 w-11`)
but they remain four hand-rolled `<button>`s with **divergent** hover/focus recipes:

| Button | Site | Hover | Focus |
|---|---|---|---|
| AppShell menu toggle | `AppShell.tsx:236` | `border-border` + `bg-surface` + `active:scale-95` | *(none — missing the hairline)* |
| ThemeToggle | `ThemeToggle.tsx:23` | `border-border` + `bg-surface` + `active:scale-95` | `focus-visible:border-border` |
| SearchExpand | `SearchExpand.tsx:55` | `border-border` + `bg-surface` + `active:scale-95` | `focus-visible:border-border` |
| NotificationBell trigger | `NotificationBell.tsx:97` | `bg-surface-3` (diverges) | `focus-visible:ring-1 ring-brand-ink` (diverges) |

Three share one recipe; the bell diverges on both hover and focus; the menu toggle
silently lacks the `focus-visible:border-border` hairline the other two have. This is
exactly the DRY gap WP-N surfaced as a deferred candidate.

## Goal

One `IconButton` primitive — a 44px icon-only button with a single unified state
recipe — consumed by all four sites. Render-neutral for ThemeToggle and SearchExpand
(one benign delta: they gain `shrink-0`, which the menu toggle already had — it only
matters under header flex-shrink pressure, where it *protects* the 44px target, so
strictly an improvement); the bell's hover/focus normalize to the shared recipe; the
menu toggle gains the focus hairline. The primitive faithfully keeps the four originals'
`transition-colors` + `active:scale-95` press (no smooth transform-transition) so the
approved "only the bell changes" scope holds — matching Button's eased press is a
deferred polish candidate.

## Design

### Component — `src/components/IconButton.tsx`

```
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;   // REQUIRED — icon-only button must carry an accessible name (SC 4.1.2)
  loading?: boolean;      // spinner replaces icon, sets aria-busy + disabled (mirrors Button)
}
```

- `React.forwardRef<HTMLButtonElement, IconButtonProps>` — **required**: the bell mounts
  it under Radix `<DropdownMenuTrigger asChild>`, which needs ref + prop forwarding.
- **Base classes** (tokens only, PRN-12), the ThemeToggle/SearchExpand recipe verbatim so
  those two are pixel-identical after the swap:
  ```
  grid h-11 w-11 shrink-0 place-items-center rounded-md border border-transparent
  text-text-2 transition-colors hover:border-border hover:bg-surface
  focus-visible:border-border active:scale-95 disabled:opacity-50 disabled:pointer-events-none
  ```
- Focus: the global `:focus-visible` 1px `--brand-ink` outline (globals.css:310) **plus**
  the subtle `focus-visible:border-border` hairline — no per-component ring.
- **One 44px size only.** All four sites are `h-11 w-11`; no size variants (YAGNI).
- `loading`: reuse Button's spinner. Export the currently-private `Spinner` from
  `Button.tsx` and import it here rather than duplicating the SVG.
- `children` = the icon (svg or icon-wrapper span). Passed through untouched — the bell
  keeps its inner 18px badge-anchor `<span class="relative grid h-[18px] w-[18px]">`
  (the WP-N badge-anchor learning) as children.
- `className` merged via `cn()` last (consumer override), same idiom as Button/Switch.
- Spreads `...rest` so `aria-expanded`, `aria-label`, `onClick`, `type` pass through.
  Default `type="button"` (never submit).

### Call-site swaps (4)

1. **`AppShell.tsx`** menu toggle — `<button ref={menuBtnRef} …>` → `<IconButton ref={menuBtnRef}
   aria-label="Toggle navigation" aria-expanded={navOpen} onClick={toggleNav}>`. `menuBtnRef`
   type is already `HTMLButtonElement` (forwardRef preserves it). Silently gains the focus hairline.
2. **`ThemeToggle.tsx`** — `<button …>` → `<IconButton>`. Render-identical.
3. **`SearchExpand.tsx`** collapsed state — `<button …>` → `<IconButton>`. Render-identical.
   (The expanded `<form>` is untouched.)
4. **`NotificationBell.tsx`** trigger — `<button …>` → `<IconButton>`, keeping the inner
   badge-anchor span + svg + badge as children. Visible change: hover `bg-surface-3` →
   hairline-border + `bg-surface`; custom ring → global outline.

PortalShell reuses the shared `NotificationBell` + `ThemeToggle`, so the portal chrome
is covered automatically (no PortalShell edit).

### Gallery card

Add an "IconButton" card to the permanent `src/app/gallery/page.tsx` with the full DSN-03
matrix: default, hover (note), focus-visible (note), active (note), **disabled**, **loading**.
Follow the existing Buttons-card idiom. This satisfies FRONTEND_STANDARDS §2 currency
(every primitive has a gallery card).

### Tests — `tests/unit/icon-button.test.tsx`

TDD, mirroring `switch.test.tsx`:
- renders with accessible name (the required `aria-label`).
- `loading` → `aria-busy="true"`, `disabled`, spinner present, icon absent.
- `disabled` → click handler not called.
- ref forwarding — `ref` receives the `HTMLButtonElement` (the Radix asChild contract).
- `className` merges (consumer class present alongside base).
- passes through `aria-expanded` / `onClick`.

Existing `NotificationBell` behavior tests (F-7 aria-live, F-21 error state) must stay
green after the swap — the button element and its aria-label are unchanged.

## Out of scope

- The bell badge `.6rem` count text and the group-label `.62rem` — that is **B2** (sub-13px pass).
- `ProfileMenu` trigger — verified a full-width `w-full py-2` sidebar row (~48px), already
  passes; its `h-8 w-8` avatar is decorative inside it. Not an icon button.
- Any non-chrome icon-only control (e.g. StatusSelect chevron is inside a Radix trigger).
- Size variants — only 44px exists in the app.

## Verification

- `pnpm exec vitest run tests/unit/icon-button.test.tsx --no-file-parallelism` green;
  full unit suite green serial; `pnpm typecheck` clean; eslint on changed files clean.
- Real screenshots (Playwright + throwaway `src/app/gallery/iconbtn/` route, both themes)
  proving the four chrome buttons render identically (theme/search/menu) and the bell
  normalized; or computed-style readback of the four buttons' hover/focus classes.
- Self-audit: PLAYBOOK §6 checklist printed. Agents on the diff: **pr-reviewer** (always),
  **audit-design-system** (MANDATORY — new primitive/token discipline, state-matrix
  completeness), **audit-a11y** (icon-only accessible name, focus visibility, 44px target),
  **audit-frontend-arch** (component reuse, client boundary).

## Owner gates

- Explicit "go" before committing AND before pushing (per-action).
- One commit for the whole WP (spec + plan + component + swaps + gallery + tests).
