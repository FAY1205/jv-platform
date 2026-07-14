# WP-PW-2b — Partner Portal: dashboard KPI deltas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the partner portal dashboard's four KPI tiles (Leads / New / Contacted / Closed) the same **prior-window delta** ("↑ N vs prior" / "all time") the admin dashboard already shows via the shared `HeroKpi`. The portal KPIs currently pass no `delta`. This was deferred from WP-PW-2 (UI-only) to here.

**Architecture (why this is low-risk):** The scoped SQL in `partnerPerformanceDetail` already fetches **all** of the partner's kept/released lead facts (no date filter — the pure `buildPartnerPerformance` does the windowing). `rangeWindow(range, now)` already returns `prevStart`/`prevEnd` (the immediately-preceding equal-length window), and ranges.ts already exports a pure `deltaOf(cur, prev)`. So the delta figures are derived **from the same already-scoped facts by a pure function** — **no new query, no new WHERE, no new scope surface.** The change is: (1) `buildPartnerPerformance` also aggregates the prior window; (2) `partnerDashboardStats` returns per-KPI deltas via `deltaOf`; (3) the portal dashboard passes `delta` to `HeroKpi`.

**Tech Stack:** Next 16 (App Router, TS), React, TanStack Query v5, Drizzle (Postgres), Zod v4, Tailwind v4, Vitest + jsdom (unit) + node (integration against the local DB).

## Global Constraints

- **PRN-08 (tenant/partner isolation).** No query changes: `partnerPerformanceDetail`'s single scoped `db.execute` (tenant + `partnerOwnsLead` + `deleted_at is null` + `mls_status='kept'` + partner hold-gate) is **untouched**. Prior-window figures are computed purely from the facts that query already returns. audit-tenancy MUST confirm no new read path and no scope widening.
- **PRN-15 (single home of a statistic; never re-derive).** The prior-window figures live in the SAME analytics module (`buildPartnerPerformance`) that owns the current-window figures — not recomputed in the route or the component. The delta uses the EXISTING pure `deltaOf(cur, prev)` (ranges.ts), the one definition of a delta.
- **PRN-01 (purity).** `buildPartnerPerformance` stays pure — `now` injected, no I/O, same input ⇒ same output. The prior-window math reuses `rangeWindow(...).prevStart/prevEnd` (already computed) over the same `facts`.
- **ASN-02 (no special-casing).** Prior "New/untouched" reuses the exact same predicate as current (`inRange(receivedAt) && firstTouchAt===null`, measured as-of-`now`) over the prior window — no bespoke prior-only logic. Document the as-of-now semantics; do not special-case.
- **Additive interface only.** `PartnerPerformance` gains a top-level `prior` field (parallel to `stats`, `null` for the "all" range) — a NEW sibling, so the existing `stats`/`history` shape is unchanged and the admin consumers (`partnerPerformanceDetail` → `src/app/partners/[id]` + `/api/admin/partners/[id]/performance`) keep working untouched. `PartnerDashboardStats` gains four `*Delta` fields.
- **PRN-12 tokens only; DSN-03** — no UI primitive change; `HeroKpi` already renders `delta`.
- **Zod at the boundary** — the route's existing `RangeSchema.parse(...).catch("30d")` stays; no new params.
- **Test names carry requirement IDs** (`PW2B-…`, ANA-02). Integration runs against the local DB (`.env.local` has `DATABASE_URL`); vitest SERIAL (`--no-file-parallelism`). Component tests need `// @vitest-environment jsdom` first line.
- **ONE commit per WP** (this branch's convention = a `docs(portal-web)` plan commit + a `feat(wp-pw-2b)` commit) after explicit owner "go"; push after a separate "go".

---

## Design decision for owner sign-off — deltas on both breakpoints, or desktop only?

The portal dashboard renders `HeroKpi` tiles in **two** places: the desktop two-column hero (`≥ lg`) and the shipped **mobile** stacked layout (`< lg`, `dense`). Adding a `delta` prop makes `HeroKpi` render a third line ("↑ N vs prior" / "all time"), which slightly increases tile height.

- **Recommended:** show the delta on **both** breakpoints — it's the natural meaning of "portal KPIs gain deltas," it matches the admin dashboard, and mobile partners benefit from the trend line equally. This is a deliberate, useful enhancement to the mobile dashboard (not a regression); the WP-PW-2 `dense` pixel-exactness was a UI-only holdover precisely because deltas were deferred to here.
- **Alternative:** desktop-only, leaving the mobile tiles pixel-exact as shipped.

The plan below wires **both** (recommended). If the owner picks desktop-only, drop the four mobile `delta=` props in Task 2 (trivial).

*(Minor polish either way: the KPI **loading skeleton** tiles don't reserve space for the delta line, so there's a tiny one-line layout shift when numbers arrive — same as the admin dashboard today. Optional to add a third skeleton line; called out in Task 2, not required.)*

---

## File Structure

**Modified:**
- `src/modules/analytics/partner-performance.ts` — refactor the current-window accumulation loop into a small pure `accumulate(facts, startMs, endMs)` helper; call it for the current window AND (when `prevStart`/`prevEnd` are non-null) the prior window; add `prior: { given, contacted, closed, untouched } | null` to `PartnerPerformance`.
- `src/modules/portal/queries.ts` — `partnerDashboardStats` computes `deltaOf(cur, prior)` for each of leads/untouched/contacted/closed; extend `PartnerDashboardStats` with `leadsDelta`, `untouchedDelta`, `contactedDelta`, `closedDelta` (`number | null`).
- `src/app/portal/dashboard/portal-dashboard.tsx` — pass `delta={s.leadsDelta}` etc. to the four desktop `HeroKpi` tiles and (recommended) the four mobile ones.
- Tests: extend `tests/unit/partner-performance.test.ts` (prior figures + "all" ⇒ null) and `tests/integration/portal-dashboard.test.ts` (deltas + scope).

**Not touched:** `partnerPerformanceDetail`'s SQL, `scope.ts`, the route (returns the extended object as-is), `HeroKpi.tsx`, any schema/migration.

---

## Task 1: Prior-window figures in the analytics core + portal deltas

**Files:**
- Modify: `src/modules/analytics/partner-performance.ts`, `src/modules/portal/queries.ts`
- Test: `tests/unit/partner-performance.test.ts` (unit, pure), `tests/integration/portal-dashboard.test.ts` (scoped)

**Interfaces:**
- `PartnerPerformance` gains `prior: { given: number; contacted: number; closed: number; untouched: number } | null`. `null` iff `rangeWindow(range, now).prevStart === null` (i.e. range `"all"`).
- `PartnerDashboardStats` gains `leadsDelta`, `untouchedDelta`, `contactedDelta`, `closedDelta: number | null`, each `= deltaOf(cur, prior?.X ?? null)` (so `"all"` ⇒ all deltas `null` ⇒ `HeroKpi` shows "all time").

Design:
- In `buildPartnerPerformance`, extract the current-window counters (`given`/`contacted`/`closed`/`untouched`, NOT `avgContactHours` — no delta tile for it) into a pure `accumulate(facts, startMs, endMs)` returning `{ given, contacted, closed, untouched }`. Keep `avgContactHours` + the `history` series exactly as they are (compute `stats` from `accumulate(current)` + the existing `avgContactHours` pass). Compute `prior = w.prevStart && w.prevEnd ? accumulate(facts, w.prevStart.getTime(), w.prevEnd.getTime()) : null`.
- `untouched` semantics unchanged: a lead **received** in the window whose `firstTouchAt` is `null` as of `now`. Applied identically to the prior window — a fair, consistent as-of-now comparison; no special-casing (ASN-02).
- `partnerDashboardStats`: after `const perf = await partnerPerformanceDetail(...)`, return the existing four figures plus `leadsDelta: deltaOf(perf.stats.given, perf.prior?.given ?? null)`, `untouchedDelta: deltaOf(perf.stats.untouched, perf.prior?.untouched ?? null)`, `contactedDelta: deltaOf(perf.stats.contacted, perf.prior?.contacted ?? null)`, `closedDelta: deltaOf(perf.stats.closed, perf.prior?.closed ?? null)`. The `!scope.partnerId` early return gets the four deltas as `null`.

- [ ] **Step 1: Write the failing unit test** in `tests/unit/partner-performance.test.ts`. With an injected fixed `now` and hand-crafted facts spanning the current AND prior windows (for `30d`: some `receivedAt`/`firstTouchAt`/`closedAt` in `[now-30d, now)`, some in `[now-60d, now-30d)`), assert:
  - `PW2B-01 (ANA-02): buildPartnerPerformance returns prior {given,contacted,closed,untouched}` matching the prior-window counts.
  - `PW2B-02: range "all" ⇒ prior === null` (no prior window).
  - `PW2B-03: stats (current window) + history are unchanged` by the refactor (a regression guard — reuse/मirror an existing assertion).
- [ ] **Step 2: Run it and watch it fail** — `pnpm test:unit -- --no-file-parallelism tests/unit/partner-performance.test.ts` → FAIL (`prior` undefined).
- [ ] **Step 3: Write the failing integration test** in `tests/integration/portal-dashboard.test.ts` (follow the existing portal-dashboard DB/scope harness). Seed one partner (Tenant A) with kept leads dated into BOTH windows with known touched/closed states, plus a SECOND partner and/or a second tenant with their own prior-window leads. As the first partner's scope, assert:
  - `PW2B-04: partnerDashboardStats(range=30d)` returns `leadsDelta/contactedDelta/closedDelta/untouchedDelta = current − prior` for that partner's OWN leads.
  - `PW2B-05: range="all" ⇒ all four deltas are null`.
  - `PW2B-06 (PRN-08): the other partner's / other tenant's prior-window leads do NOT affect this partner's deltas` (cross-check the deltas are computed only from the caller's scoped facts).
- [ ] **Step 4: Run it and watch it fail** — the integration runner on that file → FAIL.
- [ ] **Step 5: Implement** the `accumulate` refactor + `prior` field in `partner-performance.ts` and the four deltas in `partnerDashboardStats`. Keep the SQL, `avgContactHours`, and `history` byte-unchanged.
- [ ] **Step 6: Green + full suites + typecheck + lint** — the new unit + integration tests, then the FULL unit suite (`pnpm test:unit -- --no-file-parallelism`) and the partner-performance + portal-dashboard integration tests (confirm the admin `partner-performance`/`dashboard` integration + `partners/[id]` still pass — the `prior` field is additive), then `pnpm typecheck`, then `npx eslint` on the changed files (0/0).

---

## Task 2: Wire the deltas into the portal dashboard KPIs

**Files:**
- Modify: `src/app/portal/dashboard/portal-dashboard.tsx`
- Test: `tests/unit/portal-dashboard.test.tsx` (jsdom) — extend if present, else add a focused case.

**Interfaces:**
- Consumes: the extended `PartnerDashboardStats` (`*Delta` fields) from `/api/portal/dashboard`; `HeroKpi`'s existing `delta?: number | null` prop.

Design:
- Pass `delta={s.leadsDelta}` / `s.untouchedDelta` / `s.contactedDelta` / `s.closedDelta` to the corresponding desktop `HeroKpi` tiles (Leads/New/Contacted/Closed) AND — per the owner's sign-off (recommended) — the four mobile (`dense`) tiles. `HeroKpi` renders "↑/↓/· N vs prior" for a number and "all time" for `null`.
- No other change. (Optional, if the owner wants zero load-shift: add a third `Skeleton` line to the KPI loading tiles so their height matches the loaded tiles — otherwise leave as-is, matching the admin dashboard.)

- [ ] **Step 1: Write/extend the failing component test** — `tests/unit/portal-dashboard.test.tsx` (`// @vitest-environment jsdom`; mock `@/lib/api` `apiGet` to return stats WITH the `*Delta` fields by URL; mock `useIsDesktop`; `QueryClientProvider`). Assert `PW2B-07`: a KPI tile renders the delta line ("vs prior" for a numeric delta; "all time" when the API returns `null` deltas for range `all`). Look at the WP-PW-2 portal-dashboard test for the harness.
- [ ] **Step 2: Run it and watch it fail** — the desktop/mobile tiles don't yet pass `delta` → FAIL.
- [ ] **Step 3: Implement** the `delta=` props (both breakpoints per sign-off). Hooks unchanged; `useIsDesktop` gate for the single-map-mount is untouched.
- [ ] **Step 4: Green + full unit suite + typecheck + lint** — the component test, then `pnpm test:unit -- --no-file-parallelism`, `pnpm typecheck`, `npx eslint` on the changed file (0/0).
- [ ] **Step 5: Mobile-parity note** — if the owner chose desktop-only, confirm the mobile tiles carry NO `delta` prop; if both (recommended), note the mobile tiles now render the delta line (the intended, sign-off'd change).

---

## Verification (before the walkthrough)

- **Unit** proves the pure prior-window math + the "all" ⇒ null path; **integration** proves the deltas are correct AND scoped (a second partner/tenant's prior leads don't leak into the caller's deltas). **Component** proves the tiles render the delta line.
- **Live (optional):** the throwaway public gallery route + mock-seeded QueryClient rendering the real `PortalDashboard` with `*Delta` values (both themes), to eyeball the "vs prior" line on desktop + mobile; delete before commit. In-app screenshots may stall → DOM/computed-style readback; Playwright if it reconnects.

## Reviews (mandatory)

- `pr-reviewer` (always) + **`audit-tenancy`** (mandatory — a scoped analytics read change; prove NO new query path, that `prior` derives only from the caller's already-scoped facts, and that deltas can't reflect another partner/tenant) + `audit-api-contract` (the additive `/api/portal/dashboard` response fields + the additive `PartnerPerformance.prior`). `audit-design-system`/`audit-a11y` only if the KPI-delta rendering warrants it (the `HeroKpi` delta line already shipped + a11y-reviewed on admin — a light glance suffices). Opus whole-branch review at the end. Owner walkthrough before committing.

## Self-audit + commit

- PLAYBOOK §6 self-audit printed in the summary. Treat as **Tier A-adjacent** (a scope-guarded analytics read) → run the tenancy checklist even though no SQL changed. ONE `feat` commit (+ the `docs` plan commit) after owner "go"; push after a separate "go".

---

## Deliverable

After WP-PW-2b: the portal dashboard's four KPI tiles show prior-window deltas identical in treatment to the admin dashboard, on desktop (and mobile, per sign-off), derived purely from the caller's already-scoped facts (no new query). **Next: the F-1 tenancy hardening** — self-scope the `LATEST_STATUS` correlated subquery in `listPartnerLeads` (add its own `tenant_id`, symmetric to admin; optional defence-in-depth) + the draft PRN "correlated child subqueries in WHERE/ORDER BY must be self-scoped."
