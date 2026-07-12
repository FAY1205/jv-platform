# WP-N — Touch targets: shared chrome icon buttons ≥44px (F-66) (design)

**Date:** 2026-07-12 · **Status:** proposed, pending owner review · **Depends:** none (independent).
**Inputs:** cleanup menu **slice D** ("app-wide ≥44px pass on shared bell/theme/NotesPanel 'Add note', F-66"); the shared chrome components; WCAG 2.5.5 (Target Size, AAA 44px) / 2.5.8 (Target Size Minimum, AA 24px) — F-66 adopts the stronger 44px.
**Scope:** the small square icon buttons in the app chrome + the NotesPanel "Add note" button → 44px tappable area. **No behavior, color, or icon-size change.**

## 1. Context — verified control sizes

Audited the shared interactive controls. Sub-44px tap targets:

| control | file:line | current | shell(s) |
|---|---|---|---|
| NotificationBell trigger | `NotificationBell.tsx:97` | `h-8 w-8` (32px) | admin + portal |
| ThemeToggle | `ThemeToggle.tsx:23` | `h-9 w-9` (36px) | admin + portal |
| SearchExpand | `SearchExpand.tsx:55` | `h-9 w-9` (36px) | admin |
| AppShell menu toggle | `AppShell.tsx:236` | `h-9 w-9` (36px) | admin (mobile) |
| NotesPanel "Add note" | `NotesPanel.tsx:123` | `<Button>` md (`min-h-9`, 36px) | admin + portal |

**Already passing (no change):** `ProfileMenu` trigger — verified it's a full-width sidebar row (`w-full … px-2 py-2` + a 32px avatar → ~48px tall), well above 44px; its `h-8 w-8` avatar is a decorative circle inside that large row, not the tap target. PortalShell bottom tabs are `min-h-[48px]`. The `Button` primitive already ships a **44px `lg` size** (`sizes.lg = "… min-h-11"`).

## 2. Confirmed decisions (owner, 2026-07-12)

1. **Scope = the shared chrome icon-button cluster + NotesPanel** (the 5 above); form controls (Switch 26px, Checkbox 16px, Pagination, DropdownMenu items) are OUT (a broader, more disruptive pass with WCAG inline/spacing exceptions — separate candidate).
2. **Inline size bump** (not an `IconButton` extraction) — change each control's size in place; note `IconButton` as a slice-B candidate.

## 3. Design

**Icon buttons → 44px box, icon unchanged.** The buttons use `grid … place-items-center`, so enlarging the box keeps the SVG centered at its current size — only the tappable area grows.

- `NotificationBell.tsx:97`: `h-8 w-8` → `h-11 w-11`.
- `ThemeToggle.tsx:23`: `h-9 w-9` → `h-11 w-11`.
- `SearchExpand.tsx:55`: `h-9 w-9` → `h-11 w-11`.
- `AppShell.tsx:236` (menu toggle): `h-9 w-9` → `h-11 w-11`.

(`h-11 w-11` = 2.75rem = 44px. `place-items-center` unchanged.)

**NotesPanel "Add note"** (`NotesPanel.tsx:123`): add `size="lg"` to the existing `<Button variant="secondary">` — reuses the primitive's existing 44px size, no new CSS.

**Topbar height.** Bumping the controls 36→44px would grow the sticky headers (`AppShell.tsx:229` `py-3`; `PortalShell.tsx:66` `py-3`) by ~8px. Trim those headers' vertical padding (`py-3` → `py-2`) so the header stays ~visually stable while the controls reach 44px — **decided per-shell during build against a screenshot** (keep whichever reads correctly; the acceptance bar is "controls are 44px AND the header doesn't look bloated").

## 4. Non-goals (explicit)

- No `IconButton` primitive extraction (→ slice B; the 4 chrome buttons keep their inline classNames).
- No form-control resizing (Switch/Checkbox/Pagination/DropdownMenu/StatusSelect) — separate candidate; several already meet WCAG 2.5.8's 24px minimum or its inline/spacing exceptions.
- No icon-size, color, focus-ring, hover, or behavior change — only the tappable box grows.
- `Dialog` close and other modal icon buttons — not in the named chrome cluster; noted, not touched.

## 5. Verification (no unit-testable logic — this is CSS/layout)

There is no pure helper to TDD (a className size change). Proof is runtime + visual:
- **Computed-readback** (Playwright / JS eval): `getBoundingClientRect()` height AND width ≥ 44 on each of the 5 controls, in the running app (both shells).
- **Screenshots** both shells (admin topbar + portal header), light + dark, confirming the controls read correctly and the header isn't bloated. Render the portal header via the throwaway public gallery-route technique if auth blocks it; delete before commit; `rm -rf .playwright-mcp`.

## 6. Process

- Inline execution (5 files + possibly the 2 headers; small, tightly coupled).
- `pnpm typecheck` (className changes are type-inert but run it) + full unit suite serial (confirm nothing broke) + eslint changed files.
- Reviews on the diff: `pr-reviewer` (always) + **`audit-a11y`** (mandatory — WCAG 2.5.5/2.5.8 target size; confirm the 44px is met and nothing else regressed) + `audit-design-system` (control-sizing consistency; confirm the bump doesn't break the chrome's visual rhythm).
- PLAYBOOK §6 self-audit printed. Owner walkthrough (screenshots) before commit; second go before push. One commit (WP-N).

## 7. Tier

Tier B (cosmetic/a11y sizing; no data/security/pipeline/scope surface). No ADR.

## WP candidates surfaced (do not build here)

- **`IconButton` primitive** — DRY the 4 near-identical chrome icon-button classNames (`grid h-11 w-11 place-items-center rounded-md border border-transparent …`) → slice B.
- **Form-control target sizes** — Switch (26px)/Checkbox (16px)/Pagination/DropdownMenu items/StatusSelect; a separate WCAG 2.5.8 pass weighing the inline/spacing exceptions.
