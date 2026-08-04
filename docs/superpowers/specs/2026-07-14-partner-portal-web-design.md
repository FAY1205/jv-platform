# Partner Portal (Web) — responsive desktop layout — design

**Status:** approved direction (owner, 2026-07-14) · pending spec review
**Branch:** phase-2/distribution · **Depends on:** the shipped mobile portal (WP-F.1/F.2/F.3) and the admin "Survey" component library.

## Goal

Give the partner portal a proper **desktop/web layout** that matches the admin app's look and interaction language, while leaving the shipped **mobile** experience exactly as it is. Same four sections (Dashboard / Leads / Activity / Account), same partner-scoped data — a responsive evolution, not a second app.

Owner decisions locked during brainstorming:
1. **Same portal, responsive** — one codebase/routes; desktop layout kicks in at a breakpoint. Mobile unchanged.
2. **Admin left-rail shell** on desktop (not a top nav bar) — maximize structural consistency with the admin `AppShell`; page title in the top bar (the `PageHeader` pattern).
3. **Sortable Leads table** on desktop (cards stay on mobile).
4. **Dashboard map = the real `CountyCoverageMap`, matching the admin dashboard** — the county-dissolved-to-state **choropleth** (NOT the tile-cartogram placeholder used in the brainstorm mockup), partner-scoped via `buildPartnerTerritory`; non-owned states neutral/anonymized (PRN-08).
5. **Match the admin "vibe" throughout** — reuse the admin component library and hero/table patterns, not restyled lookalikes.

## Non-goals

- No new partner-facing **features or data** beyond what the mobile portal already shows (no contact actions — owner has declined Call/Email/Text three times; no cross-partner data; no rules/coverage-editing; no partner-switching).
- **No change to the mobile portal** — `< md` renders exactly today's chrome (top bar + bottom tabs, 520px column) and today's page bodies.
- No new dependencies. No schema migration (the one backend change is additive query params + dynamic `orderBy`).

## Architecture

### Responsive shell — evolve `PortalShell`

`src/components/PortalShell.tsx` becomes responsive rather than mobile-only. It is wrapped in a `PageHeaderProvider` (the same generic provider the admin uses — `src/components/PageHeader.tsx`), and renders **two breakpoint-exclusive chromes** around one shared content region:

- **`< md` (mobile — unchanged):** the current sticky top bar (brand + `NotificationBell` + `ThemeToggle`) + sticky **bottom tab bar** (Dashboard / Leads / Activity / Account), 520px centered column. Byte-for-byte the shipped behavior; `md:hidden`.
- **`≥ md` (desktop — new):** an admin-style layout mirroring `AppShell`:
  - **Left rail** (`hidden md:flex`, sticky, `md:h-screen`): brand mark → a single "Portal" nav group (the 4 sections, each with icon; active = `bg-brand-soft text-brand-ink`; a lead-count badge on Leads) → the **partner identity block** pinned at the bottom (`PartnerTag`-style: avatar + name + `JV-###`) with a sign-out affordance.
  - **Top bar** (sticky): the **page title** on the left (see below) + `NotificationBell` + `ThemeToggle` on the right.
  - **Content column:** no 520px cap; a comfortable `max-w-[1120px]` reading measure with `AppShell`-parity padding.

Breakpoint = `md` (768px), the same threshold `AppShell` uses for its rail, so admin and portal switch at the same width. The bare `/portal/login` and `/portal/tos` routes keep rendering with **no chrome** (unchanged).

The content region stays a plain `<div>` (not `<main>`) so each page keeps its own single `<main>` landmark — the existing rule.

### Page title on desktop

The desktop top bar shows the current section title. To keep the mobile pages untouched, the title is derived from the route by a small **route→title map inside the shell** (`usePathname`), not by threading `usePageHeader` through every page. Each page's existing in-body `<h1>` is marked `md:hidden` so it still titles the mobile view but doesn't duplicate the desktop top-bar title. (Dashboard is the exception: its in-body **hero headline** — "N leads across your M-state territory" — is not the page title and stays visible on both, exactly as the admin dashboard shows both a top-bar "Dashboard" and an in-body hero headline.)

`usePageHeader` remains available if a later slice wants page-specific top-bar *actions*; this spec does not require it (range/filter controls live in-body on both breakpoints — see Dashboard).

### Per-screen desktop layouts

**Dashboard** — the admin hero pattern (`src/app/dashboard/page.tsx` shape):
- A two-column hero `lg:grid-cols-[1fr_1.2fr]`: **left** = eyebrow + amber headline + KPI tiles; **right** = the real `CountyCoverageMap` in a `min-h-[280px]` panel with `PartnerTag` beneath.
- KPIs use a **shared `HeroKpi`** (extracted from the admin dashboard — see Backend) so tiles carry the same label · mono value · **prior-window delta** · calc tooltip as admin. Tiles: Leads / New (untouched) / Contacted / Closed.
- Map = `CountyCoverageMap` (the county→state **choropleth**) with the portal's existing props (`states={territory.states}`, `neutralUncovered`, `interactive={false}`, `ariaLabel`), lazy-loaded via `next/dynamic ssr:false` — identical usage to the admin/mobile-portal dashboards. Partner-scoped via `buildPartnerTerritory` (non-owned states anonymized — PRN-08).
- **Range** = `SegmentedControl<RangeKey>` (7d/30d/12mo/all), in-body above the hero, on both breakpoints.
- A **"Recent leads"** preview `Table` (5 rows) below the hero with a "View all leads →" link, mirroring the admin dashboard's below-hero tables.

**Leads** — responsive card↔table swap:
- `< md`: the current `LinkCard` list (unchanged).
- `≥ md`: the shared `Table`/`Th sortable`/`Pagination` primitives (the admin leads pattern, `src/app/leads/leads-view.tsx`). Columns: Ref · Address · City · ST · ZIP · Received · Status (pill). Optional status filter via `SegmentedControl` (All/New/Contacted/Closed). Row → lead detail (existing `/portal/leads/[ref]`).

**Activity** — `< md` keeps the current card/list; `≥ md` a `Table` (When · Event · Lead), same data.

**Account / Devices** — `< md` unchanged; `≥ md` a two-column `Card` grid (Profile + Security/Devices with per-device sign-out). Same `/api/me` + `/api/sessions` data.

## Backend / API changes (additive, no migration)

1. **`/api/portal/leads` gains `sort`, `dir`, and `status` params** (Zod-validated, mirroring the admin `LeadsQuerySchema` but a restricted safe set): `sort ∈ {received, status, city, state, ref}`, `dir ∈ {asc, desc}`, optional `status` filter. `listPartnerLeads` (`src/modules/portal/queries.ts`) swaps its hardcoded `orderBy(desc(createdAt))` for a dynamic `orderBy` over a **whitelisted column map** (never raw input), and applies the optional status filter. **All existing scope guards stay** (`leadWhere(scope)`, `mlsStatus="kept"`, `isNull(deletedAt)`, hold-release) — PRN-08/SEC-05 unchanged; sorting/filtering only reorders/narrows the partner's own already-scoped rows. Page size can adopt the shared `Pagination` PAGE_SIZES (default stays 50 or moves to the shared default — decided in the plan).

2. **Extract a shared `HeroKpi`** from the admin dashboard's local component into `src/components` (props `{ label, value, delta?, tone?, tip? }`), and use it in **both** the admin dashboard and the portal dashboard so the KPI treatment is identical (DRY, guarantees the "same vibe"). The admin dashboard is refactored to import the shared component (behavior-preserving).

3. **Portal dashboard deltas:** `/api/portal/dashboard` returns the **prior-window** values the delta tiles need (the scoped `partnerPerformanceDetail` already computes prior figures for some stats; extend where a tile lacks one). Still fully scoped (PRN-08).

## Data scope & security

- Every new/changed read stays behind `scope.ts`/`leadWhere` (PRN-08) — the sort/filter additions reorder or narrow the partner's own rows only; a partner can never sort or filter into another partner's data.
- No new PII surfaced (SEC-05) — the desktop table shows the same fields the mobile cards already show.
- `buildPartnerTerritory` anonymization of non-owned states is preserved.
- CSV export path (`/api/portal/leads/export`) unchanged (SEC-06 sanitization intact); the desktop table reuses the existing export link.

## Testing

- **Component:** the responsive shell (desktop rail renders at `md`, mobile chrome hidden; bare login/tos); the desktop Leads `Table` (sortable `Th` `aria-sort`, `Pagination`); shared `HeroKpi` (delta + tooltip). Component tests need `// @vitest-environment jsdom`.
- **Integration (scoped, PRN-08):** `/api/portal/leads` sort/dir/status returns only the partner's rows in the requested order; an out-of-set `sort` value is rejected (Zod); tenancy — the sort/filter cannot cross partner scope.
- **A11y:** left-rail nav is keyboard-reachable with `aria-current`; the desktop top-bar title is a single `<h1>` (no duplicate with the `md:hidden` body title); focus/`prefers-reduced-motion` respected; both themes (computed-style or real screenshots per the environment).
- Serial vitest (`pnpm test:unit -- --no-file-parallelism`), typecheck + lint separately.

## Implementation slicing (for the plan)

Sized for **~3 WPs**, each independently shippable & reviewable:
- **WP-PW-1 — Responsive shell:** evolve `PortalShell` (desktop rail + top bar + `PageHeaderProvider`), route→title map, `md:hidden` on page `<h1>`s. Mobile visually unchanged. No page-body layout changes yet (pages render inside the new desktop column as-is).
- **WP-PW-2 — Desktop Dashboard + shared `HeroKpi`:** extract `HeroKpi`, admin-style hero (KPIs + real map + recent-leads table), portal-dashboard deltas.
- **WP-PW-3 — Desktop Leads (table + API) + Activity/Account desktop layouts:** the `/api/portal/leads` sort/filter delta + the responsive table; Activity table; Account two-column grid.

Each WP: brainstorm-approved design (this doc) → writing-plans → TDD build → PLAYBOOK §6 self-audit + pr-reviewer (+ audit-tenancy on WP-PW-3 for the query change, audit-design-system + audit-a11y on the UI) → owner walkthrough (mockup/real screenshots) → one commit.

## Reference

Approved mockup (both themes, left-rail shell): the desktop-portal Artifact from the 2026-07-14 brainstorm. Component-reuse map and admin patterns: see the admin `AppShell`, `PageHeader`, `src/app/dashboard/page.tsx`, `src/app/leads/leads-view.tsx`, `src/components/Table.tsx`, `src/components/Pagination.tsx`, `src/modules/portal/queries.ts`, `src/modules/coverage/partner-territory.ts`.
