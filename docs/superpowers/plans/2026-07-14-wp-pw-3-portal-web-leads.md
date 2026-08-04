# WP-PW-3 — Partner Portal Web: desktop Leads (sortable table + sort/filter API) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the partner portal Leads page a desktop layout — the admin-style **sortable table** with server-side sort + status filter + pagination — while leaving the mobile Leads page (cards + prev/next) unchanged. This requires an additive, **tenancy-safe** extension to `/api/portal/leads` and `listPartnerLeads`.

**Architecture:** `/api/portal/leads` gains Zod `sort`/`dir`/`status`/`pageSize` params (graceful "degrade to default, never throw" style, mirroring `pageParam`). `listPartnerLeads` swaps its hardcoded `orderBy` for a **whitelist sort→column map** (never raw input), adds a **tenant/partner-scoped correlated latest-status subquery** for the optional status filter applied INSIDE the shared `baseWhere` (so the row query and the `count(*)` stay consistent), and threads a real `pageSize`. The portal Leads page renders mobile (cards + prev/next, unchanged) or the desktop table (`Table`/`Th sortable`/`Pagination` + a status filter) via the `useIsDesktop()` gate.

**Tech Stack:** Next 16 (App Router, TS), React, TanStack Query v5, Drizzle (Postgres), Zod v4, Tailwind v4, Vitest + jsdom (unit) + node (integration against the local DB).

## Global Constraints

- **PRN-08 (tenant/partner isolation) — the load-bearing rule.** Every read stays behind `leadWhere(scope)` + `mlsStatus="kept"` + `isNull(deletedAt)` + `releasedLeads()` (partner hold gate). The new sort/filter params must NEVER reach a `where` clause except through **validated, whitelisted** values. The status filter's correlated subquery MUST inherit the outer scope (correlate on `lead_id = leads.id`, itself scoped by the shared `baseWhere`) — mirror admin's `LATEST_STATUS`. Bind values (`sql\`… = ${s}\``); never string-interpolate a param into SQL.
- **Count consistency:** `baseWhere` is the single source shared by the row `select` and the `count(*)`. Any status filter goes INTO `baseWhere` so `total` matches the rows. Never JS-filter after fetch (breaks paging/count).
- **SEC-05:** no new PII — the desktop table shows the same `PartnerLeadRow` fields the mobile cards already show (refId, seller name, address/city/state/zip, receivedAt, status). No seller phone/email.
- **Portal status whitelist = the 6 `SEED_LEAD_STATUSES`** (`New, Contacted, Appointment, Under contract, Closed, Dead`) — NOT the admin 7 (portal leads are always `mlsStatus="kept"`, so no "Removed MLS").
- **Stable sort:** every `orderBy` ends with a deterministic tiebreak `desc(leads.createdAt)` (like admin) so paging never duplicates/skips.
- **Mobile (`< lg`) Leads unchanged** — the shipped card list + prev/next pager + export link + `md:hidden` h1 stay exactly as they are (extract them verbatim into a `MobileLeads` piece).
- **PRN-12 tokens only; DSN-03** states via the reused primitives (`Th sortable`, `Pagination`, `SegmentedControl`/pills, `statusPillClass`).
- **Zod at the boundary; uniform error envelope** — but keep the portal route's existing graceful `.parse` style (invalid params degrade to defaults, never 400).
- **Test names carry requirement IDs** (e.g. `PW3-01`). Integration tests run against the local DB (`.env.local` has `DATABASE_URL`); vitest SERIAL (`--no-file-parallelism`). Component tests need `// @vitest-environment jsdom` first line.
- **ONE commit per WP** after explicit owner "go"; push after a separate "go".

---

## File Structure

**Modified:**
- `src/modules/portal/queries.ts` — extend `listPartnerLeads(scope, opts)`: whitelist sort→column map, optional scoped status filter (correlated subquery in `baseWhere`), real `pageSize`. Add a `PORTAL_LEAD_SORT_FIELDS` whitelist + a portal status filter list (reuse `SEED_LEAD_STATUSES`).
- `src/app/api/portal/leads/route.ts` — parse `sort`/`dir`/`status`/`pageSize` (graceful), pass to `listPartnerLeads`.
- `src/app/portal/leads/page.tsx` — `useIsDesktop()` gate: mobile = today's cards+pager (extracted, unchanged); desktop = the sortable table + status filter + `Pagination`.

**New:**
- `src/app/portal/leads/leads-desktop.tsx` — `"use client"` desktop table component (sort/dir/status/page/pageSize state, one query, `Table`/`Th sortable`/`Pagination`).
- Tests: `tests/unit/portal-leads-desktop.test.tsx` (jsdom — table renders, sort toggles, filter resets page); `tests/integration/portal-leads-sort-filter.test.ts` (scoped: sort order, status filter + count consistency, a partner cannot sort/filter into another partner's rows).

**Not touched:** Activity/Account/Devices (that's WP-PW-4).

---

## Task 1: Tenancy-safe sort + status filter in the portal leads query + route

**Files:**
- Modify: `src/modules/portal/queries.ts`, `src/app/api/portal/leads/route.ts`
- Test: `tests/integration/portal-leads-sort-filter.test.ts`

**Interfaces:**
- Produces: `listPartnerLeads(scope, opts: { page?: number; pageSize?: number; sort?: PortalLeadSort; dir?: "asc" | "desc"; statuses?: readonly string[] }): Promise<PartnerLeadPage>` where `type PortalLeadSort = "received" | "status" | "city" | "state" | "ref"`. (Back-compat: all opts optional; defaults = the current behavior — `received`/`desc`, no status filter, pageSize 50.) Consumed by the route + Task 2.

Design (mirror `src/modules/leads/queries.ts:49-116`, keep the portal scope guards):
- **Sort whitelist map** — `sort → column`: `received → leads.createdAt` (default), `status → STATUS_ORDER` (a `case ${STATUS_EXPR} …` rank), `city → lower(leads.city)`, `state → leads.state`, `ref → leads.refId`. `dir` → `asc`/`desc`. `orderBy(dirFn(sortCol), desc(leads.createdAt))` — always the stable tiebreak.
- **Scoped latest-status expression** — a correlated subquery, scoped by correlating on the lead and inheriting `baseWhere` (the outer query is already tenant/partner-scoped): `LATEST_STATUS = sql\`(select status from lead_status_history where lead_id = ${schema.leads.id} order by created_at desc limit 1)\``; `STATUS_EXPR = sql<string>\`coalesce(${LATEST_STATUS}, 'New')\`` (portal is always `kept`, so no "Removed MLS" branch). **NOTE:** if `lead_status_history` needs tenant scoping beyond the `lead_id` correlation for defence-in-depth, add `and tenant_id = …` inside the subquery — verify against `leadChildWhere`'s shape and keep it scoped.
- **Status filter** — when `statuses` non-empty (already whitelisted to the 6), push `or(...statuses.map((s) => sql\`${STATUS_EXPR} = ${s}\`))` INTO `baseWhere` so BOTH the row query and the `count(*)` filter identically.
- **pageSize** — accept a whitelisted `pageSize` (reuse `pageSizeParam`'s `{10,20,50}`, default 50 to preserve current behavior) and use it for `limit`/`offset` + the returned `pageSize`.

- [ ] **Step 1: Write the failing integration test** — `tests/integration/portal-leads-sort-filter.test.ts`. Seed (or reuse the integration seed helpers) two partners in one tenant, each with a few leads in known cities/states with known latest statuses. Assert, as a PARTNER scope:
  - `PW3-01: sort=city dir=asc` returns the partner's OWN rows in ascending city order (and never the other partner's rows).
  - `PW3-02: statuses=["Closed"]` returns only the partner's leads whose latest status is Closed, and `total` equals that filtered count (count-consistency).
  - `PW3-03: an unknown sort value falls back to received/desc` (no throw, no scope leak).
  - `PW3-04: a partner cannot sort or filter into another partner's leads` — with any sort/status, the result set is a subset of the partner's own leads (cross-check against a direct scoped count).
  Follow the existing portal integration tests for the DB/scope harness (`tests/integration/portal-*.test.ts`).

- [ ] **Step 2: Run it and watch it fail** — `pnpm test:integration -- --no-file-parallelism tests/integration/portal-leads-sort-filter.test.ts` (or the repo's integration runner) → FAIL (opts not supported).

- [ ] **Step 3: Implement the query change** in `src/modules/portal/queries.ts`: add the `PortalLeadSort` type + whitelist map, the scoped `STATUS_EXPR`, the status filter into `baseWhere`, the `pageSize`, and the stable tiebreak. Keep `leadWhere`/`mlsStatus`/`deletedAt`/`releasedLeads` intact and shared by row + count. Export `PORTAL_LEAD_SORT_FIELDS` + a `PORTAL_STATUS_FILTERS` (= `SEED_LEAD_STATUSES`) for the route + UI.

- [ ] **Step 4: Implement the route** in `src/app/api/portal/leads/route.ts`: parse `sort`/`dir`/`status`/`pageSize` in the graceful style (whitelist via `includes`, `csv` for statuses against `PORTAL_STATUS_FILTERS`, `dir` → asc/desc, `pageSizeParam()`), pass them to `listPartnerLeads`. Keep the ToS gate + the existing `pageParam`.

- [ ] **Step 5: Run the integration test green + the full unit suite + typecheck + lint**

Run: the integration test, then `pnpm test:unit -- --no-file-parallelism`, then `pnpm typecheck`, then `npx eslint` on the changed files (0/0). Expected: green (existing `/api/portal/leads` behavior preserved for the no-opts default path).

---

## Task 2: Desktop Leads table

**Files:**
- Modify: `src/app/portal/leads/page.tsx`
- Create: `src/app/portal/leads/leads-desktop.tsx`
- Test: `tests/unit/portal-leads-desktop.test.tsx`

**Interfaces:**
- Consumes: `listPartnerLeads` params via `/api/portal/leads?sort=&dir=&status=&page=&pageSize=` (Task 1); `Table`/`THead`/`Th`/`TBody`/`Tr`/`Td` + `Pagination` (+ `PAGE_SIZES`/`DEFAULT_PAGE_SIZE`) from `@/components`; `statusPillClass` from `@/lib/status-pill`; `useIsDesktop` from `@/lib/use-media-query`; `PORTAL_STATUS_FILTERS` from `@/modules/portal/queries`.

Design (mirror `src/app/leads/leads-view.tsx`, portal-scoped):
- **`page.tsx`**: call `useIsDesktop()` UNCONDITIONALLY at the top; keep the shared header (the `md:hidden` h1, `{total} total`, export link — but `total` now comes from whichever child is active, so lift the header text into each child OR keep a lightweight always-rendered header). Render `{isDesktop ? <LeadsDesktop/> : <LeadsMobile/>}`. Extract today's card list + prev/next pager VERBATIM into a `LeadsMobile` piece (unchanged behavior; still `useQuery(["portal-leads", page])` page-only).
- **`leads-desktop.tsx`** (`LeadsDesktop`): state `sort` (`PortalLeadSort`, default `"received"`), `dir` (default `"desc"`), `statuses` (default `[]`), `page` (1), `pageSize` (`DEFAULT_PAGE_SIZE` 20 or 50 — pick 20 to match the shared primitive). A derived `filterKey` resets `page` to 1 when sort/dir/statuses/pageSize change (the admin pattern — a compare, not an effect). One `useQuery({ queryKey: ["portal-leads-desktop", filterKey, page, pageSize], queryFn: () => apiGet(\`/api/portal/leads?\${params}\`) })`. Render a `Table` with `Th sortable sortDir={sort===f?dir:null} onSort={()=>onSort(f)}` on Ref/City/State/Received/Status (+ Address, Seller non-sortable), rows link to `/portal/leads/{refId}` (reuse `RowOpenButton` or a clickable `Tr`), `statusPillClass(status)`; a status filter (a small `SegmentedControl` for "All" + the 6, or admin-style pill toggles); and `<Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange onPageSizeChange/>`. Loading `Skeleton`; empty/error compact `EmptyState`.

- [ ] **Step 1: Write the failing test** — `tests/unit/portal-leads-desktop.test.tsx` (jsdom; mock `@/lib/api` to return a fixed `PartnerLeadPage`; mock `useIsDesktop`→true; wrap in `QueryClientProvider`). Assert: the table renders the mocked lead refs; clicking a sortable `Th` calls the API with the new `sort`/`dir` (spy on `apiGet` args); selecting a status filter resets to page 1 and includes `status=` in the request. Keep assertions on real rendered content + request params.

- [ ] **Step 2: Run it and watch it fail** — module missing / gate not wired → FAIL.

- [ ] **Step 3: Implement** `leads-desktop.tsx` + wire the `useIsDesktop` gate in `page.tsx` (extract `LeadsMobile` verbatim). Keep all hooks unconditional (the parent calls `useIsDesktop` before any return; each child owns its own hooks). Tokens only.

- [ ] **Step 4: Green + full suite + typecheck + lint** — the desktop test, then `pnpm test:unit -- --no-file-parallelism`, `pnpm typecheck`, `npx eslint` (0/0, no `react-hooks/rules-of-hooks`).

- [ ] **Step 5: Mobile-parity self-check** — `git diff` the extracted `LeadsMobile`: the card list, prev/next pager, export link, and `md:hidden` h1 classes/behavior are unchanged from the pre-image. Note any delta.

---

## Verification (before the walkthrough)

- Integration: the scoped sort/filter tests prove isolation + count-consistency. Component: the desktop table's sort/filter request wiring.
- Live: with Playwright MCP now connected (or the throwaway-public-route + mock-seeded QueryClient technique), render the desktop Leads table at `≥ lg` (sort a column, apply a status filter) and confirm mobile `< lg` is the unchanged card list. Both themes.

## Reviews (mandatory)

- `pr-reviewer` (always) + **`audit-tenancy`** (the query change — prove the sort/filter can't cross partner/tenant scope and the status subquery stays scoped) + `audit-api-contract` (the additive `/api/portal/leads` params) + `audit-design-system` + `audit-a11y` (the table: `aria-sort`, keyboard sort, pagination). Owner walkthrough before committing.

## Self-audit + commit

- PLAYBOOK §6 self-audit printed in the summary (Task 1 is Tier A-ish — a scoped-query change; run the tenancy checklist). ONE commit after owner "go"; push after a separate "go".

---

## Deliverable

After WP-PW-3: the desktop Leads page is the admin-style sortable, filterable, paginated table (server-side, tenancy-safe); mobile Leads unchanged. **Next: WP-PW-4** = Activity desktop table (keep prev/next — no `total`) + Account/Devices desktop two-column card grid (pure UI). Then **WP-PW-2b** = dashboard KPI deltas.
