# Frontend Standards — JV Platform

Canonicalizes the frontend patterns this codebase follows. Authority order:
`docs/SPEC.md` (§6.13–6.17) > ADRs > this document. Open decisions are `TODO(owner)`.

## 1. Data fetching & state (FEP-01, ADR-0008)

- Server data lives in **TanStack Query only** — never copied into `useState`, never
  in a global store. Query keys are structured arrays; every mutation invalidates the
  queries it affects.
- The one blessed exception: seeding an editable draft from server data uses the
  **adjust-state-during-render** pattern (`data !== seededFrom` guard), never
  `setState`-in-`useEffect` (`react-hooks/set-state-in-effect` is an error).
- Client state is minimal UI preference state; no new global stores.
- Polling is a last resort; the ceiling is the NotificationBell 20s poll.
  `TODO(owner)`: pause polling when the tab is hidden.

## 2. Components (DSN, §6.17)

- All UI is composed from `src/components` — the living roster is the barrel
  (`src/components/index.ts`); every primitive also appears in `/gallery` (D1: the
  prose count kept drifting, so the barrel is now the source of truth).
  Repeated ad-hoc markup means: promote a primitive first, then use it.
- Every interactive component implements **default / hover / focus-visible / active /
  disabled / loading**. `/gallery` is the living showcase — new components appear there
  in the same WP.
- Type sizes come from the `text-step-0..7` ladder (DSN-11, `globals.css`; floor
  `text-step-0` = 12px). No arbitrary `text-[…]` font-size literals in app source —
  guarded by `tests/unit/type-scale.test.ts`.
  - **Exception (glyph-fit, not type-scale):** the `NotificationBell` unread-count badge
    (`text-[.6rem]`, fits a 16px circle) is sized to its container, not to a reading
    step — kept sub-floor by design and excluded from the ladder (and from the guard's
    ban list). (The hex map's on-polygon labels — the second former carve-out — retired
    with the hex `CoverageMap`, D1 2026-07-15.)
- Known debt: `TODO(owner)` a `Checkbox` primitive (notification prefs use styled inputs).

## 3. Tokens & theming (PRN-12, SEAM-08)

- No hex, font, logo, or product name outside `src/lib/tokens` + `src/app/globals.css`.
  Components consume semantic tokens (`text-text-2`, `bg-surface`, …).
  - **Exception (algorithmic, not brand):** `src/modules/export/render.ts` contains literal
    `#000000`/`#FFFFFF` (and their bare ExcelJS ARGB forms) as WCAG contrast *endpoints* (the
    black/white the relative-luminance pick compares against), not brand identity — never route
    it through theme tokens, which would break the ratio math. (`src/lib/contrast.ts` carries
    no hex literals since D1 retired `contrastText`/`contrastHalo`; it is pure `hex: string`
    math and no longer an exception.) Enforced by `tests/unit/token-sweep.test.ts` (D4).
  - **Exception (canvas paint, not brand):** `src/components/assistant/Orb.tsx` renders a
    theme-aware plasma orb on a `<canvas>`; canvas 2D cannot consume CSS `var(--token)`, so its
    glass/ribbon paint palette holds raw color values (the orb's visual identity, like the SVG
    map paint). The DOM chrome around the orb uses tokens only.
- Both themes are first-class: every surface verified in light AND dark.
- Partner colors come only from `PARTNER_SWATCHES` (additive-only, AA-vetted,
  distance-checked — EXP-06); the same token source feeds UI, export legend, and emails.

## 4. Client/server boundary (FEP-06)

- Server components by default; `"use client"` islands are as small as possible.
- Client files never import server-only modules (`src/lib/env.ts`,
  `src/lib/supabase/admin.ts`, `src/db/*`, `drizzle`, `exceljs`).
- Heavy parsing runs in `src/workers` (xlsx via `parseWorkbookInWorker`); nothing
  blocks the main thread > 50 ms.
- Edge-safe code (used by `src/proxy.ts`) avoids `node:*` imports.

## 5. Forms (FRM, §6.15)

- Inline errors under the field; the submit is disabled-while-pending (`loading` prop);
  uniform server messages surface verbatim (no invented client copy for auth).
- No double-submit: pending state + idempotent APIs (API-03) together.
- Destructive actions (void, deactivate) use a confirm `Modal` that states consequences
  in plain language, and require a reason where the spec demands one.

## 6. Lists & performance (FEP-03/04, API-02)

- List endpoints paginate server-side (50/page pattern). Lists that can exceed ~200
  rows are virtualized — `TODO(owner)`: adopt `@tanstack/react-virtual` for the global
  leads/unmatched views (deferred FEP-03; unmatched is high-volume by design).
- Search/filter inputs are debounced; scroll/resize handlers throttled; keystrokes must
  not re-render tables (memo boundaries at row level).
- Bundle discipline: `exceljs`, main-thread `xlsx`, `postgres`, `drizzle` never reach a
  client bundle. `TODO(owner)`: set numeric first-load JS budgets per route and
  re-enable the Lighthouse CI gate (FEP-08) once deployed.

## 7. Accessibility (PRN-14, WCAG 2.1 AA)

- Color never carries meaning alone: partner name + `JV-###` accompany every color —
  bars, rails, legends, exports (SC 1.4.1). Fills keep AA text contrast (SC 1.4.3) in
  both themes, **no exceptions**. (The former ADR-0024 carve-out for on-fill map labels
  was retired with the hex `CoverageMap` — ADR-0029; the county map never draws
  on-fill text.)
- Keyboard: modals trap focus, Esc closes, focus returns to the opener; menus/selects
  operable without a pointer (SC 2.1.1); `focus-visible` styling on every interactive
  element (SC 2.4.7).
- Programmatic labels on all fields (the `Input label=` pattern); toasts/status changes
  announced via `aria-live` (SC 4.1.3).
- Verification: `pnpm audit:axe` against a served build (`pnpm audit:serve`) — the
  a11y audit agent runs this and maps violations to success criteria.
  `TODO(owner)`: run cadence (suggested: every Tier B checkpoint + pre-gate).

## 8. UX states (UXQ, §6.14)

- Every async interaction renders all four states: loading (`Skeleton`), empty
  (`EmptyState` with orientation, not a blank table), error (the `{code,message}`
  envelope surfaced honestly), success.
- Progress is honest (UXQ-02): step indicators reflect real stages — no fake spinners.

## 9. Responsive & browser targets

- Portal must be usable at 375 px (partners check leads on phones); admin at ≥ 768 px;
  no horizontal body scroll anywhere.
- Playwright currently runs desktop-chromium only. `TODO(owner)`: add a mobile-viewport
  Playwright project for `/portal/*` and decide the official browser-support statement
  (suggested: evergreen Chrome/Edge/Firefox/Safari, last 2).
