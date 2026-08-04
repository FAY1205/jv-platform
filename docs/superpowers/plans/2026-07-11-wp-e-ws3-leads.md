# WP-E / WS-3 Leads — Survey reskin + LeadDialog territory matchcard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Adopt the Survey identity into the Leads page + lead detail (mockup 02), and add the signature "matchcard" to the LeadDialog — a partner-territory map scoped to the lead's partner plus a plain-language "why routed" explanation. The page already meets R3 §4 WS-3 functionally (isolated filter bar F-54, Table primitives, pagination FEP-03, code-split dialog F-56, MatchMethod map F-57) — this is a reskin + one additive feature, not a rebuild.

**Architecture:** The lead detail stays a centered `Dialog` (per the WP-E brief "keep the page's architecture — audit's best screen"), NOT the mockup's right drawer (mockup-only, like its simplified geometry). The matchcard is a new `LeadTerritory` component reusing the real `CountyCoverageMap` in single-partner highlight mode (`selectedPartnerId`), lazy-loaded (~0.9MB geometry). The "why routed" sentence is a pure helper in `src/lib/match-method.ts`. The page title moves to the topbar `PageHeader` slot (consistency with the dashboard), which requires splitting `LeadsView` into a shell wrapper + a body that renders inside `AppShell`'s provider.

**Tech Stack:** Next.js App Router (client components), TanStack Query, Tailwind semantic tokens, Vitest + Testing Library (jsdom), existing `src/components` + `CountyCoverageMap`.

## Global Constraints (verbatim from the WP-E brief / CLAUDE.md)

- PRN-12: no hardcoded hex/font in page code — tokens only. `--brand`=marigold fill · `--brand-ink`=amber text/links · `--brand-contrast`=fixed-dark text on marigold · `--border-strong`=table rules.
- PRN-15: statistics from `src/modules/analytics` only. (WS-3 adds no statistics; the territory map consumes the existing `/api/coverage` model.)
- PRN-08: server data via TanStack Query hitting already-scoped routes (`/api/leads*`, `/api/coverage`, `/api/admin/partners`). No new query paths.
- PRN-14: partner color never alone — the territory map's partner-colored fills are accompanied by the partner name + `JV-###` in the map caption; `PartnerTag` unchanged elsewhere.
- No sub-13px chrome text (WP-A/C): bump the `.65rem` label cluster in the touched files to `text-[.8125rem]`.
- Test names carry requirement IDs.
- **ONE commit for the whole workstream.** Internal tasks END AT GREEN TESTS. The final task runs the self-audit + reviews + an owner walkthrough, then commits once. **The owner is remote — STOP before the commit and leave a walkthrough (Playwright screenshots both themes + summary) for their sign-off.**
- vitest SERIAL: `pnpm test:unit -- --no-file-parallelism`. `pnpm typecheck` separately. eslint the CHANGED files (repo-wide lint has pre-existing `.claude/worktrees/*/.next` noise).

## Decisions (owner away — made autonomously, flag at the walkthrough)

1. **Dialog, not drawer.** Keep the existing `Dialog`; the mockup's right drawer is mockup-only. (Brief: keep architecture.)
2. **Matchcard only for matched leads.** When the lead has an effective partner, show the territory map + why-routed sentence. Unmatched kept leads already show the "Unmatched" warn label in the ViewMode header — no map (no partner territory to show).
3. **Title → topbar** (`usePageHeader({ title: "Leads" })`), matching the dashboard; the in-body `<h1>`/subtitle are removed. No Export/New-import topbar actions (they aren't in the current page — adding them is scope creep for a reskin).

---

## File Structure

- **Modify** `src/lib/match-method.ts` — add pure `routingExplanation()`.
- **Modify** `tests/unit/match-method.test.ts` — add `routingExplanation` cases.
- **Create** `src/app/leads/lead-territory.tsx` — the `LeadTerritory` matchcard (map + why sentence).
- **Modify** `src/app/leads/lead-dialog.tsx` — render `LeadTerritory` in ViewMode; bump `.65rem` labels to 13px.
- **Modify** `src/app/leads/leads-view.tsx` — split `LeadsView` (wrapper) / `LeadsBody` (calls `usePageHeader`); remove the in-body `<h1>`/subtitle.

---

## Task 1: `routingExplanation` helper

**Files:** Modify `src/lib/match-method.ts`; Test `tests/unit/match-method.test.ts`.

**Interfaces — Produces:**
`routingExplanation(o: { partnerName: string; manual: boolean; matchMethod: string; zip: string; state: string }): string` — the plain-language "why this partner" sentence.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/match-method.test.ts` (add `routingExplanation` to the import from `@/lib/match-method`):

```ts
describe("routingExplanation (F-57)", () => {
  const base = { partnerName: "Summit Partners", manual: false, matchMethod: "zip", zip: "98075", state: "WA" };
  it("F-57: ZIP match names the ZIP", () => {
    expect(routingExplanation(base)).toBe("Routed to Summit Partners because ZIP 98075 falls inside their territory.");
  });
  it("F-57: state fallback names the state", () => {
    expect(routingExplanation({ ...base, matchMethod: "state_fallback" })).toBe("Routed to Summit Partners by state coverage — WA falls back to them.");
  });
  it("F-57: manual assignment overrides the match method", () => {
    expect(routingExplanation({ ...base, manual: true })).toBe("Manually assigned to Summit Partners.");
  });
  it("F-57: unknown method degrades to a plain assignment sentence", () => {
    expect(routingExplanation({ ...base, matchMethod: "none" })).toBe("Assigned to Summit Partners.");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`routingExplanation` not exported):

Run: `pnpm exec vitest run tests/unit/match-method.test.ts --no-file-parallelism`
Expected: FAIL — `routingExplanation is not a function` / import error.

- [ ] **Step 3: Implement** — append to `src/lib/match-method.ts`:

```ts
/** ADM-02 "matching moment": the plain-language reason a lead landed with its partner.
 *  Manual assignment overrides the pipeline match method; never throws. */
export function routingExplanation(o: {
  partnerName: string;
  manual: boolean;
  matchMethod: string;
  zip: string;
  state: string;
}): string {
  if (o.manual) return `Manually assigned to ${o.partnerName}.`;
  if (o.matchMethod === "zip") return `Routed to ${o.partnerName} because ZIP ${o.zip} falls inside their territory.`;
  if (o.matchMethod === "state_fallback") return `Routed to ${o.partnerName} by state coverage — ${o.state} falls back to them.`;
  return `Assigned to ${o.partnerName}.`;
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `pnpm exec vitest run tests/unit/match-method.test.ts --no-file-parallelism`
Expected: PASS (existing cases + 4 new).

- [ ] **Step 5: Typecheck.** `pnpm typecheck` → 0.

---

## Task 2: `LeadTerritory` matchcard + LeadDialog integration + reskin

**Files:** Create `src/app/leads/lead-territory.tsx`; Modify `src/app/leads/lead-dialog.tsx`.

**Interfaces — Consumes:** `routingExplanation` (Task 1); existing `CountyCoverageMap` (`selectedPartnerId`, `caption`); `CoverageMapResponse` from `@/modules/coverage/map`; `/api/coverage`.
**Produces:** `LeadTerritory({ partner, manual, matchMethod, zip, state })` rendered in `ViewMode`.

- [ ] **Step 1: Create `src/app/leads/lead-territory.tsx`:**

```tsx
"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Skeleton } from "@/components";
import { routingExplanation } from "@/lib/match-method";
import type { CoverageMapResponse } from "@/modules/coverage/map";

// The "matchcard" (mockup 02) — the matching moment for a matched lead: the partner's
// territory highlighted on the real coverage map + a plain-language routing reason.
// Map geometry (~0.9 MB) is code-split so opening a lead never blocks on it; PRN-14 is
// kept by the map caption naming the partner + JV-### alongside the colored fills.
const CountyCoverageMap = dynamic(() => import("@/components/CountyCoverageMap").then((m) => m.CountyCoverageMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[210px] w-full rounded-lg" />,
});

export interface LeadTerritoryProps {
  partner: { id: string; name: string; refId: string; color: string };
  manual: boolean;
  matchMethod: string;
  zip: string;
  state: string;
}

export function LeadTerritory({ partner, manual, matchMethod, zip, state }: LeadTerritoryProps) {
  const coverage = useQuery({ queryKey: ["coverage"], queryFn: () => apiGet<CoverageMapResponse>("/api/coverage") });
  const why = routingExplanation({ partnerName: partner.name, manual, matchMethod, zip, state });
  return (
    <section className="overflow-hidden rounded-xl border border-border-soft bg-surface-2">
      <div className="relative p-3">
        {coverage.data ? (
          <CountyCoverageMap
            states={coverage.data.states}
            selectedPartnerId={partner.id}
            caption={{ title: partner.name, subtitle: partner.refId }}
          />
        ) : coverage.isError ? (
          <div className="grid h-[210px] place-items-center text-sm text-text-3">Territory map unavailable.</div>
        ) : (
          <Skeleton className="h-[210px] w-full rounded-lg" />
        )}
      </div>
      <p className="border-t border-border-soft px-4 py-3 text-sm text-text-2">{why}</p>
    </section>
  );
}
```

- [ ] **Step 2: Integrate into `ViewMode`** (`src/app/leads/lead-dialog.tsx`). Add the import near the top (with the other local imports, after the `offersUnassign` import):

```tsx
import { LeadTerritory } from "./lead-territory";
```

Then in `ViewMode`, insert the matchcard immediately after the header `<div className="flex items-start justify-between gap-3">…</div>` block and before the `<div className="grid grid-cols-2 …">` details grid:

```tsx
      {d.partner && (
        <LeadTerritory
          partner={d.partner}
          manual={d.assignment.manual}
          matchMethod={d.assignment.matchMethod}
          zip={d.zip}
          state={d.state}
        />
      )}
```

- [ ] **Step 3: Reskin — bump sub-13px chrome to 13px** in `src/app/leads/lead-dialog.tsx`:
  - `Field` label: `text-[.65rem]` → `text-[.8125rem]` (line ~155).
  - `ActivityLog` heading `<h3>`: `text-[.65rem]` → `text-[.8125rem]` (line ~253).

Exact edits:
```
- <span className="text-[.65rem] font-semibold uppercase tracking-wide text-text-3">{label}</span>
+ <span className="text-[.8125rem] font-semibold uppercase tracking-wide text-text-3">{label}</span>
```
```
- <h3 className="mb-3 text-[.65rem] font-semibold uppercase tracking-wide text-text-3">Activity</h3>
+ <h3 className="mb-3 text-[.8125rem] font-semibold uppercase tracking-wide text-text-3">Activity</h3>
```

- [ ] **Step 4: Typecheck + lint the two files.**

Run: `pnpm typecheck` (→0) and `pnpm exec eslint src/app/leads/lead-territory.tsx src/app/leads/lead-dialog.tsx` (→0).

---

## Task 3: Leads page title → topbar (split `LeadsView`)

**Files:** Modify `src/app/leads/leads-view.tsx`.

**Key note:** `usePageHeader` must run inside `AppShell`'s `PageHeaderProvider`. `LeadsView` currently renders `<ToastProvider><AppShell>…</AppShell></ToastProvider>` and can't call the hook (it's the parent of `AppShell`). Split into `LeadsView` (wrapper) + `LeadsBody` (child of `AppShell`, calls the hook).

- [ ] **Step 1: Add `usePageHeader` to the `@/components` import** in `leads-view.tsx`:

```
-  AppShell, Card, Table, THead, TBody, Th, Tr, Td, PartnerTag, EmptyState, Skeleton,
-  ToastProvider, Input, Select, DateRangePicker, Pagination, RowOpenButton, StatusSelect,
-  DEFAULT_PAGE_SIZE,
+  AppShell, Card, Table, THead, TBody, Th, Tr, Td, PartnerTag, EmptyState, Skeleton,
+  ToastProvider, Input, Select, DateRangePicker, Pagination, RowOpenButton, StatusSelect,
+  DEFAULT_PAGE_SIZE, usePageHeader,
```

- [ ] **Step 2: Split the component.** Replace the current `LeadsView` function body:

```tsx
export function LeadsView({ initialQ }: { initialQ: string }) {
  return (
    <ToastProvider>
      <AppShell>
        <LeadsBody initialQ={initialQ} />
      </AppShell>
    </ToastProvider>
  );
}

function LeadsBody({ initialQ }: { initialQ: string }) {
  usePageHeader({ title: "Leads" });

  const [filters, setFilters] = React.useState<Filters>({ ...EMPTY, q: initialQ });
  const [sort, setSort] = React.useState<LeadSortField>("received");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  const [openRef, setOpenRef] = React.useState<string | null>(null);

  const filterKey = `${filters.q}|${filters.partnerId}|${filters.state}|${filters.source}|${filters.statuses.join(",")}|${filters.dateFrom}|${filters.dateTo}|${sort}|${dir}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  if (filterKey !== resetKey) { setResetKey(filterKey); setPage(1); }

  const onSort = (field: LeadSortField) => {
    if (sort === field) setDir((p) => (p === "asc" ? "desc" : "asc"));
    else { setSort(field); setDir(DEFAULT_DIR[field]); }
  };

  return (
    <>
      <LeadsFilterBar seedQ={initialQ} onChange={setFilters} />
      <LeadsTable
        filterKey={filterKey}
        filters={filters}
        sort={sort}
        dir={dir}
        page={page}
        pageSize={pageSize}
        onSort={onSort}
        onOpen={setOpenRef}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />
      {openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </>
  );
}
```

(This removes the old in-body `<div className="mb-6"><h1>Leads</h1>…</div>` header; the title now lives in the topbar.)

- [ ] **Step 3: Typecheck + lint.**

Run: `pnpm typecheck` (→0) and `pnpm exec eslint src/app/leads/leads-view.tsx` (→0).

- [ ] **Step 4: Full serial unit suite.**

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green (existing leads component tests unaffected; +4 `routingExplanation` cases). If a leads component test asserted the old in-body `<h1>`, update it to the topbar (`page-header` mechanism) — check `tests/unit/components/leads-components.test.tsx`.

---

## Task 4: Verify, self-audit, reviews, walkthrough (STOP — owner remote)

**Files:** none (verification + the eventual single commit — NOT in this session unless the owner returns and approves).

- [ ] **Step 1: Gate.** `pnpm typecheck` · `pnpm exec eslint` on the changed files · `pnpm test:unit -- --no-file-parallelism` (green) · `pnpm exec vitest run tests/integration/leads-list.test.ts --no-file-parallelism` if leads integration exists (WS-3 changes no leads SQL, so it should be unaffected — confirm).

- [ ] **Step 2: Real screenshots (Playwright, both themes).** `/leads` is auth-gated, so render the matchcard in a THROWAWAY public preview route `src/app/gallery/lead-territory-preview/page.tsx`: a mock `Dialog`-like card containing `LeadTerritory` with mock partner + coverage data (mirror the WS-2 preview pattern — mock `StateCoverage[]`, `?t=light|dark` sets `document.documentElement.dataset.theme`). `preview_start` name "web"; navigate + screenshot both themes at desktop width; then DELETE the preview route. Also confirm the topbar shows "Leads" and no in-body h1.

- [ ] **Step 3: PLAYBOOK §6 self-audit** — fill + print the checklist. Confirm PRN-12 (no hex), PRN-14 (map caption names the partner), PRN-08 (existing scoped routes), no sub-13px chrome left in the touched files, requirement-ID test names.

- [ ] **Step 4: pr-reviewer + /audit frontend** on the working-tree diff. Address findings; re-gate.

- [ ] **Step 5: OWNER WALKTHROUGH — STOP.** The owner is remote. Post the screenshots + a summary + the filled self-audit + the flagged decisions (Dialog-not-drawer, matchcard-only-for-matched, title-to-topbar). **Do NOT commit until the owner approves.** When approved, commit Tasks 1–3 as ONE WS-3 commit (requirement-ID test names, `Co-Authored-By` trailer), local only (no push).

---

## Self-Review

**Spec coverage (WP-E WS-3 row + R3 §4 WS-3 + brief):**
- Reskin to Survey via existing primitives — page already on primitives; +13px chrome bumps + topbar title. ✅
- LeadDialog partner-territory map panel — Task 2 `LeadTerritory`. ✅
- R3 §4 function kept (filter isolation, pagination, code-split dialog, MatchMethod map, NotesPanel, status) — untouched by this diff. ✅
- Deep-links open LeadDialog (F-55) — unchanged (already the case). ✅

**Placeholder scan:** none — every step has full content.

**Type consistency:** `routingExplanation` signature matches between Task 1 def, its test, and `LeadTerritory` (Task 2). `LeadTerritory` props (`partner{id,name,refId,color}`, `manual`, `matchMethod`, `zip`, `state`) match `LeadDetail.partner` + `LeadDetail.assignment` + `d.zip`/`d.state` in `lead-dialog.tsx`. `CoverageMapResponse`/`CountyCoverageMap` props match the coverage module + component.

**Risk flagged for the walkthrough:** the territory map shows the partner's STATE coverage; a ZIP-matched lead's state may not be in that set (ZIP overrides aren't state-level) — the why-routed sentence explains the ZIP match separately, so the map is territory context, not the match proof. Confirm this reads clearly.

**Review outcomes (pr-reviewer + audit-frontend-arch + audit-a11y).** FIXED:
- **arch F-1 (High):** the LeadDialog reassign/unassign/revert mutation now invalidates `["coverage"]` (dashboard map + attention banner + matchcard all consume it; the `/unmatched` assign flow already did this).
- **a11y F-1 (Medium, SC 2.1.1):** the matchcard map is now **static** — new `interactive?: boolean` prop on `CountyCoverageMap` (default true; `/coverage` unchanged) suppresses zoom controls / wheel-zoom / drag-pan / hover; `LeadTerritory` passes `interactive={false}`. Removes the mouse-only-pan keyboard gap + the extra dialog tab stops.
- **pr F-1 (Medium) — the state-vs-ZIP display:** added an honesty caveat under the sentence for ZIP matches ("Map shows state-level coverage; this lead matched a ZIP-level override"). This is the STOPGAP for the owner's deferred item — the map is state-level, a ZIP match is more precise; the full treatment is deferred (below).
- **pr F-2 (Low):** map slot wrapped in `aspect-[960/600]` so skeleton→map doesn't layout-jump.
- **a11y F-2 (Low, SC 4.1.3):** `role="status"` on the map-error fallback.

DEFERRED (WP candidates): pr F-3 (a LeadTerritory RTL test — routingExplanation is unit-tested + the wrapper is Playwright-verified); pr F-4 (a full sub-13px sweep of `/leads` — this WP only bumped the named `.65rem` labels); arch F-2 (type `matchMethod`/`LeadDetail.assignment.matchMethod` off the `MatchMethod` enum — kept `string`, mirroring the lenient `matchMethodLabel(m: string)`); arch F-3 (extract a shared `useCoverageQuery()` hook — fold into the WS-8 coverage rework).

**OWNER DEFERRAL (2026-07-11):** owner approved WS-3 as-is but wants to **revisit the state-match vs ZIP-match logic later** — how the territory map represents a ZIP-level match vs the partner's state coverage (and possibly the routing display more broadly). NOT in WS-3 scope; carry forward as a tracked follow-up (do not change the matchcard's state-level map now).
