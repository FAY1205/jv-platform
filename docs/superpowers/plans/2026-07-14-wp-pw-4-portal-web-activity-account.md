# WP-PW-4 — Partner Portal Web: desktop Activity table + Account/Devices grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the partner portal's last two sections a desktop layout, completing the desktop portal (Dashboard + Leads already shipped). **Activity** gets an admin-style **table** (Kind · Detail · When) with the existing prev/next pager; **Account** gets a **two-column card grid** (Profile + Devices, with per-device sign-out) on desktop. Mobile is byte-identical to today. **Pure UI — no backend, no schema, no API change.**

**Architecture:** Both surfaces follow the shipped `useIsDesktop()` gate pattern (WP-PW-2/3): the page/body calls `useIsDesktop()` unconditionally at the top and renders exactly one of a mobile child (today's markup, extracted verbatim) or a new desktop child. The desktop Activity table reuses `Table`/`THead`/`Th`/`TBody`/`Tr`/`Td` inside a `Card`, mirroring the admin Activity view (`src/app/activity/page.tsx`) but simpler — the portal activity endpoint returns `{ items, page, pageSize }` with **no `total`**, so it keeps the existing prev/next `Button` pager and does **not** wire the `Pagination` primitive. The desktop Account grid extracts the devices list+revoke into a shared `PortalDevices` component consumed by both the standalone `/portal/devices` route (mobile) and the Account right column (desktop), so there is one device-management implementation.

**Tech Stack:** Next 16 (App Router, TS), React, TanStack Query v5, Tailwind v4, Vitest + jsdom (unit/component). No integration test (no query/DB change).

## Global Constraints

- **Mobile (`< lg`) unchanged — the load-bearing rule for this WP.** Every mobile branch is today's markup **extracted verbatim**; `git diff` the extracted piece against the pre-image and confirm the card/list markup, pager, `md:hidden` h1, and empty/error/loading states are unchanged. Any delta is a bug — **the one sanctioned exception** is the sign-out `useSignOut()` DRY extraction in Task 2 (Account), which is behavior-preserving; the parity check there verifies **runtime behavior** (same fetch, same clear, same navigation), not byte-identical source. Everything else stays byte-verbatim.
- **Gate at `lg` via `useIsDesktop()`** (1024px), matching Leads. This keeps the **intentional md-vs-lg asymmetry**: the shell chrome switches at `md` (768, rail vs. bottom tabs) but page **content** switches at `lg` (1024), so 768–1024 = desktop chrome + mobile bodies. Comment it so nobody "fixes" it to `md` (same comment Leads carries).
- **No new backend / API / data.** Activity reads the existing `/api/portal/activity?page=`; Account reads the existing `/api/me`; Devices reads the existing `/api/sessions` + `/api/sessions/{id}/revoke`. **SEC-05:** no new PII (same fields already shown).
- **No in-body `<h1>` on the desktop children** — the desktop top bar already shows the section title via `portalTitleForPath` (WP-PW-1). The **mobile** children keep their `md:hidden` h1 exactly as today (it stays hidden at `≥ md`, including during the brief first-paint where the mobile child mounts on a desktop viewport before `useIsDesktop()` resolves).
- **PRN-12 tokens only; DSN-03** — every interactive element (sortless table rows, prev/next buttons, per-device sign-out, sign-out) reuses existing primitives (`Button`, `Card`, `Table`, `EmptyState`, `Skeleton`, `Badge`) which already carry the full state matrix. No hardcoded hex/font/size; sub-13px stays off the floor (reuse `text-step-*`/`text-sm`/`text-xs` as the current pages do).
- **AUT-14 preserved:** the Account sign-out keeps its exact behavior (server revoke → `qc.clear()` → `window.location.assign("/portal/login")`); the per-device revoke keeps its `["sessions"]` invalidation. Extraction must not alter either.
- **One `<main>` per page** — the desktop children render their own single `<main>` (like the mobile ones); the shell content region stays a `<div>` (unchanged).
- **Test names carry requirement IDs** (`PW4-01` …). Component tests need `// @vitest-environment jsdom` as the first line. Vitest SERIAL (`pnpm test:unit -- --no-file-parallelism`).
- **Lint the changed component files** (`npx eslint <files>`) — `react-hooks/rules-of-hooks` MUST be 0/0 (the recurring "hooks after an early return" crash was caught twice on this line; the gate hook goes before any conditional return).
- **ONE commit per WP** after explicit owner "go"; push after a separate "go".

---

## File Structure

**Modified:**
- `src/app/portal/activity/page.tsx` — becomes the `useIsDesktop()` gate: `{isDesktop ? <ActivityDesktop/> : <ActivityMobile/>}`. Today's body is extracted into `ActivityMobile` verbatim.
- `src/app/portal/portal-account.tsx` — `PortalAccount` becomes the gate: `{isDesktop ? <AccountDesktop/> : <AccountMobile/>}`. Today's body → `AccountMobile` verbatim. (`/portal/page.tsx` server component + its `md:hidden` h1 are untouched.)
- `src/app/portal/devices/page.tsx` — the device list+revoke logic moves into the new shared `PortalDevices`; this page becomes a thin wrapper (`<main>` + `md:hidden` h1 + `<PortalDevices/>`), mobile behavior unchanged.

**New:**
- `src/app/portal/activity/activity-mobile.tsx` — `"use client"` mobile Activity (extracted verbatim: `<main>` + `md:hidden` h1 + `Card`/`CardBody` list + prev/next). *(Or keep `ActivityMobile` inline in `page.tsx` — decide in Task 1; extracting a file keeps the gate file tiny and matches Leads.)*
- `src/app/portal/activity/activity-desktop.tsx` — `"use client"` desktop Activity table (no h1; `Card` → `Table` Kind·Detail·When; prev/next `Button` pager; same `["portal-activity", page]` query).
- `src/app/portal/account-desktop.tsx` — `"use client"` desktop Account two-column grid (Profile card + `PortalDevices`).
- `src/components/PortalDevices.tsx` — `"use client"` shared devices list + revoke (extracted from `devices/page.tsx`), consumed by the standalone devices route and `AccountDesktop`. Barrel-export from `@/components`.
- Tests: `tests/unit/portal-activity-desktop.test.tsx`, `tests/unit/portal-account-desktop.test.tsx` (jsdom).

**Not touched:** any `src/app/api/**`, `src/modules/**`, `src/db/**`, migrations. `portalTitleForPath` (WP-PW-1) already maps `/portal/activity` → "Your activity" and `/portal` → "Account" — verify, no change expected.

---

## Design decision for owner sign-off — Account desktop shape

The spec locks "desktop Account = two-column `Card` grid (Profile + Security/Devices with per-device sign-out)." Concretely, the **recommended** shape:

- **Left column — Profile `Card`:** avatar + email + `role · workspace` (from `/api/me`), a **Terms of service** link row (the one account link not otherwise surfaced on desktop), and the **Sign out** button.
- **Right column — Devices `Card`:** the shared `PortalDevices` (remembered devices + per-device sign-out).

On desktop the mobile "Your devices" and "Your activity" link rows are **dropped** (Devices is shown inline; Activity is a left-rail nav item), leaving only the ToS link. Mobile keeps all three links + the flat list exactly as today.

**Owner call:** approve this (Profile+Devices inline, ToS link kept) — **or** prefer the lighter alternative (desktop Account stays the profile card + the same 3-link list, just widened; Devices stays only at `/portal/devices`). Recommended = the two-column grid, since the spec chose it and it removes a redundant navigation hop on desktop. *(Happy to produce a quick visual mockup of the grid before building if you'd like to see it first — otherwise the owner walkthrough uses real screenshots at the end, per the established loop.)*

---

## Task 1: Desktop Activity table (+ mobile extraction)

**Files:**
- Modify: `src/app/portal/activity/page.tsx`
- Create: `src/app/portal/activity/activity-desktop.tsx` (+ optional `activity-mobile.tsx`)
- Test: `tests/unit/portal-activity-desktop.test.tsx`

**Interfaces:**
- Consumes: the existing `/api/portal/activity?page=` (`{ items: { when, kind: "status"|"note", detail }[], page, pageSize }`); `Table`/`THead`/`Th`/`TBody`/`Tr`/`Td`/`Card`/`Badge`/`Button`/`EmptyState`/`Skeleton` from `@/components`; `useIsDesktop` from `@/lib/use-media-query`.
- Produces: nothing new exported (page-local components).

Design (mirror `src/app/activity/page.tsx` admin table, portal-simple):
- **`page.tsx`**: call `useIsDesktop()` unconditionally, then `return isDesktop ? <ActivityDesktop/> : <ActivityMobile/>`. `ActivityMobile` = today's exact body (the `<main>` + `md:hidden` h1 + `Card`/`CardBody` + the `<ul>` list + the prev/next `Button` pager + the same `useQuery(["portal-activity", page])`).
- **`activity-desktop.tsx`** (`ActivityDesktop`): its own `useQuery(["portal-activity", page])` (same key — both children never mount together, and the shared key means a returning user reuses cache); **no h1** (top bar has "Your activity"). Render a `<main class="mx-auto w-full flex-1 p-4">` → `<Card>` containing:
  - loading → `Skeleton` rows; error → `EmptyState` ("Couldn't load activity"); empty → `EmptyState` ("No activity yet" …) — same copy as today.
  - else a `Table`:
    - `THead`: `Th` Kind · Detail · When (right-aligned When). **Not sortable** (the endpoint has no sort) — plain `Th`, no `sortable` prop.
    - `TBody`: per item — Kind cell = `<Badge variant={i.kind === "status" ? "state" : "neutral"}>{i.kind === "status" ? "Status" : "Note"}</Badge>`; Detail cell = `<span className="num text-sm text-text-2">{i.detail}</span>`; When cell = `<span className="num text-step-1 text-text-3 tabular-nums">{new Date(i.when).toLocaleString()}</span>` (align right), matching the admin activity timestamp idiom.
  - Below the `Card`, the **same prev/next `Button` pager** as mobile (no `total` → **no `Pagination` primitive**): `Previous` disabled at `page <= 1`; `Next` disabled when `items.length < (data?.pageSize ?? 50)`. Same show-condition (`page > 1 || items.length === pageSize`).

- [ ] **Step 1: Write the failing component test** — `tests/unit/portal-activity-desktop.test.tsx` (jsdom; mock `@/lib/api` `apiGet` → a fixed page of items incl. one `status` + one `note`; wrap in `QueryClientProvider`). Assert: the table renders both items' `detail`, the correct Kind badges ("Status"/"Note"), and a When timestamp; `PW4-01` the table is present (role `table`); `PW4-02` "Next" is disabled when `items.length < pageSize` and enabled when `=== pageSize`; `PW4-03` clicking "Next" refetches with `page=2`.
- [ ] **Step 2: Run it and watch it fail** — module missing → FAIL.
- [ ] **Step 3: Implement** `activity-desktop.tsx` + wire the `useIsDesktop` gate in `page.tsx` (extract `ActivityMobile` verbatim). Add the md-vs-lg asymmetry comment. Hooks unconditional.
- [ ] **Step 4: Green + full unit suite + typecheck + lint** — the new test, then `pnpm test:unit -- --no-file-parallelism`, `pnpm typecheck`, `npx eslint` on the changed files (0/0, no `rules-of-hooks`).
- [ ] **Step 5: Mobile-parity self-check** — `git diff` the extracted `ActivityMobile` vs. the pre-image `page.tsx` body: list markup, pager, `md:hidden` h1, empty/error/loading unchanged. Note any delta.

---

## Task 2: Desktop Account two-column grid (+ shared `PortalDevices`)

**Files:**
- Modify: `src/app/portal/portal-account.tsx`, `src/app/portal/devices/page.tsx`
- Create: `src/app/portal/account-desktop.tsx`, `src/components/PortalDevices.tsx` (+ barrel export)
- Test: `tests/unit/portal-account-desktop.test.tsx`

**Interfaces:**
- Consumes: `/api/me` (`{ email, role, workspace: { name } }`), `/api/sessions` (`{ devices: Device[] }`), `/api/sessions/{familyId}/revoke`; `Card`/`CardBody`/`CardHeader`/`CardTitle`/`Button`/`EmptyState`/`Skeleton`/`LinkCard` from `@/components`; `initialsFromEmail` from `@/lib/identity`; `csrfHeaders` from `@/lib/csrf-client`; `useIsDesktop`.
- Produces: `PortalDevices` (default or named export; barrel-exported).

Design:
- **`PortalDevices.tsx`**: lift the devices query + `revoke` mutation + the **inner** list/empty/error/loading rendering (the current `CardBody` contents — the `<ul>`, states, and the `role="alert"` error line) out of `devices/page.tsx` **verbatim**. `PortalDevices` renders **just that inner content**, not the `Card` frame — so each caller supplies its own framing and the mobile route stays byte-identical: `devices/page.tsx` becomes `<main>` + `md:hidden` h1 + `<Card><CardBody><PortalDevices/></CardBody></Card>` (same wrapper it has today); `AccountDesktop`'s right column wraps it in its own `Card`/`CardHeader`. Keep the `["sessions"]` query key + the `onSuccess` invalidation + `size="lg"` sign-out buttons unchanged. Barrel-export it.
- **`portal-account.tsx`** (`PortalAccount`): call `useIsDesktop()` unconditionally → `return isDesktop ? <AccountDesktop/> : <AccountMobile/>`. `AccountMobile` = today's exact `PortalAccount` body (identity `Card` + 3-link `LinkCard` list + full-width Sign out; the `["me"]` query + `signOut()` unchanged, AUT-14 intact).
- **`account-desktop.tsx`** (`AccountDesktop`): owns the `["me"]` query + sign-out. **To avoid the sign-out logic drifting across the two Account children, extract a tiny `useSignOut()` hook** (returns `{ signOut, signingOut }`; wraps the exact server-revoke → `qc.clear()` → `window.location.assign("/portal/login")` sequence, AUT-14) into `portal-account.tsx` (or a small `@/lib` client file) and call it from both `AccountMobile` and `AccountDesktop` — the `AccountMobile` extraction then references the hook instead of an inline copy (its runtime behavior is identical; verify in the parity diff). Render a `<div className="grid gap-4 lg:grid-cols-2">`:
  - **Left** `Card` → `CardBody`: the identity block (avatar + email + `role · workspace`, same skeleton/error states), a **ToS** `LinkCard`/link row, and the **Sign out** `Button` (same `signOut`).
  - **Right** `Card`: `CardHeader`/`CardTitle` "Your devices" + `<PortalDevices bare/>` (or `<CardBody><PortalDevices/></CardBody>` per the chosen framing).
  - No in-body h1 (top bar shows "Account").

- [ ] **Step 1: Write the failing component test** — `tests/unit/portal-account-desktop.test.tsx` (jsdom; mock `@/lib/api` `apiGet` to return `/api/me` + `/api/sessions` by URL; mock `fetch` for revoke/logout; `QueryClientProvider`). Assert: `PW4-04` desktop renders BOTH the profile email AND at least one device row (the two-column grid); `PW4-05` the per-device "Sign out" triggers the revoke `fetch` to `/api/sessions/{id}/revoke`; `PW4-06` the account "Sign out" calls `/api/auth/logout` then navigates (spy `window.location.assign`).
- [ ] **Step 2: Run it and watch it fail** — modules missing → FAIL.
- [ ] **Step 3: Implement** `PortalDevices.tsx` (extract verbatim) + rewire `devices/page.tsx` + `account-desktop.tsx` + the `useIsDesktop` gate in `portal-account.tsx` (extract `AccountMobile` verbatim). Barrel-export `PortalDevices`. Hooks unconditional.
- [ ] **Step 4: Green + full unit suite + typecheck + lint** — the new test, then `pnpm test:unit -- --no-file-parallelism`, `pnpm typecheck`, `npx eslint` on the changed files (0/0, no `rules-of-hooks`).
- [ ] **Step 5: Mobile-parity self-check** — `git diff`: (a) `AccountMobile` vs. the pre-image `PortalAccount` body (identity card, 3 links, sign out unchanged); (b) `devices/page.tsx` renders the same devices UI it did (now via `PortalDevices`). Note any delta.

---

## Verification (before the walkthrough)

- **Component tests** prove: the desktop Activity table + prev/next enable/disable; the desktop Account grid renders profile + devices + both sign-out paths.
- **Live:** render each desktop surface at `≥ lg` and confirm `< lg` is the unchanged mobile body, both themes, via the reusable technique (throwaway public route `src/app/gallery/<name>/` + a mock-seeded `QueryClient` — `staleTime: Infinity`, `refetchOnMount: false` — mounting the REAL `ActivityDesktop` / `AccountDesktop`; delete before commit). In-app Browser screenshots may stall → fall back to DOM/computed-style readback; Playwright MCP if it reconnects, for real images.

## Reviews (mandatory)

- `pr-reviewer` (always) + **`audit-design-system`** + **`audit-a11y`** (UI slice: table semantics, `Card` grid, focus/keyboard on prev/next + per-device sign-out, both themes, heading order — desktop bodies have no h1, the top bar owns it). **No `audit-tenancy`** (no query/scope change) — but the pr-reviewer must confirm the mobile branches are byte-identical extractions. Opus whole-branch review at the end. Owner walkthrough before committing.

## Self-audit + commit

- PLAYBOOK §6 self-audit printed in the summary. **Tier B** (pure UI, no schema/auth/pipeline/scope/rules touch) → batch-style, but this WP still gets its own plan + reviews + owner sign-off per the portal-web line's cadence. ONE commit after owner "go"; push after a separate "go".

---

## Deliverable

After WP-PW-4: **the desktop partner portal is complete** — all four sections (Dashboard, Leads, Activity, Account) have a desktop layout matching the admin "Survey" vibe, mobile byte-identical throughout. **Next: WP-PW-2b** = dashboard KPI deltas (`partnerDashboardStats` prior-window + `HeroKpi delta`; scoped analytics — audit-tenancy + a prior-window integration test), then the **F-1 tenancy hardening** (self-scope the `LATEST_STATUS` correlated subquery).
