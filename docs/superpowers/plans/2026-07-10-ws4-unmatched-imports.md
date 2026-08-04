# WS-4 Unmatched + Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rework the Unmatched inbox onto a bounded per-state aggregate + the reused paginated leads endpoint with a Dialog-based id-only Assign flow, and redesign the Import-detail page to read its Distributed stat from the server, name its void run, and open leads in the dialog.

**Architecture:** Retire the unbounded `listUnmatched` grouping; add a bounded `unmatchedStateStats` SQL aggregate; the unmatched table reuses `/api/leads?partnerId=unmatched`. Both pages open the code-split `LeadDialog` (F-55) and use WS-1 primitives.

**Tech Stack:** Next.js App Router, TanStack Query, drizzle-orm, Radix, Vitest.

## Global Constraints
- PRN-08 tenant scoping via `unmatchedWhere`/`tenantWhere`; PRN-12 tokens only; PRN-14 partner name+ref+color; PRN-15 no re-derived stats; PRN-05 assignment additive.
- No raw select/input/textarea/`Modal`/`NativeSelect`/`CountyCoverageMap` on either page.
- Requirement-ID test names; small commits; run relevant suite before each commit; no new deps.
- Verify: `pnpm vitest run tests/unit/<f>` / `tests/integration/<f> --no-file-parallelism`; `pnpm run typecheck && pnpm run lint`. Not `pnpm check` (parallel integration exhausts the pooler).

---

## Task 1: Backend — retire unbounded unmatched; add `unmatchedStateStats` (F-11)

**Files:**
- Modify: `src/modules/leads/queries.ts` (remove `listUnmatched` + the `unmatched.ts` import; add `unmatchedStateStats`)
- Delete: `src/modules/leads/unmatched.ts`, `tests/unit/unmatched-grouping.test.ts`
- Modify: `src/app/api/leads/unmatched/route.ts` (return stats)
- Test: `tests/integration/unmatched-stats.test.ts` (new)

**Interfaces:**
- Produces: `unmatchedStateStats(scope): Promise<{ total: number; byState: { state: string; count: number }[] }>`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/unmatched-stats.test.ts` (coverage.test.ts harness). Seed: 2 unmatched kept leads in TX, 1 in FL, 1 kept lead ROUTED to a partner (excluded), 1 removed lead (excluded), 1 kept lead MANUALLY assigned (excluded, PRN-05/ASN-03).

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { unmatchedStateStats } from "@/modules/leads/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-unmatched-stats-ws4";

suite("WS-4: unmatchedStateStats (ASN-03, F-11)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "UM", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [p] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const [u] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-001", status: "processed", filename: "x.csv" }).returning({ id: schema.uploads.id });
    const mk = (v: Partial<typeof schema.leads.$inferInsert>) => db.insert(schema.leads).values({ tenantId: t.id, refId: `LD-26-${Math.floor(Math.random()*100000)}`, uploadId: u.id, dedupeKey: randomUUID(), rawJson: {}, mlsStatus: "kept", matchMethod: "none", ...v });
    await mk({ state: "TX" });
    await mk({ state: "TX" });
    await mk({ state: "FL" });
    await mk({ state: "GA", partnerId: p.id, matchMethod: "zip" }); // routed → excluded
    await mk({ state: "GA", mlsStatus: "removed" });                // removed → excluded
    await mk({ state: "GA", manualPartnerId: p.id });               // manual → excluded
  });

  afterAll(async () => { await cleanup(); await client.end(); });

  it("ASN-03/F-11: counts only currently-unmatched leads, grouped by state, biggest first", async () => {
    const s = await unmatchedStateStats(scope);
    expect(s.total).toBe(3);
    expect(s.byState).toEqual([{ state: "TX", count: 2 }, { state: "FL", count: 1 }]);
  });
});
```

- [ ] **Step 2: Run it, expect fail** — `pnpm vitest run tests/integration/unmatched-stats.test.ts --no-file-parallelism` → FAIL (fn missing).

- [ ] **Step 3: Add `unmatchedStateStats`; remove `listUnmatched` + the import**

In `src/modules/leads/queries.ts`: delete the `import { groupUnmatchedByState, type UnmatchedGroup } from "./unmatched";` line and the whole `listUnmatched` function. Add:

```ts
export interface UnmatchedStateStats {
  total: number;
  byState: { state: string; count: number }[];
}

/** Bounded per-state unmatched aggregate (F-11) — feeds the stats row + state map.
 *  Currently-unmatched only (kept, no pipeline partner, no manual overlay). */
export async function unmatchedStateStats(scope: ScopeContext): Promise<UnmatchedStateStats> {
  const db = getDb();
  const rows = await db
    .select({
      state: sql<string>`coalesce(nullif(trim(${schema.leads.state}), ''), '—')`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.leads)
    .where(unmatchedWhere(scope))
    .groupBy(sql`1`)
    .orderBy(sql`count(*) desc`, sql`1`);
  const byState = rows.map((r) => ({ state: r.state, count: Number(r.count) }));
  return { total: byState.reduce((s, r) => s + r.count, 0), byState };
}
```

- [ ] **Step 4: Repurpose the route**

Rewrite `src/app/api/leads/unmatched/route.ts`:
```ts
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { unmatchedStateStats } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";

// ASN-03: the unmatched inbox's per-state stats + total (bounded, F-11). The lead
// rows themselves come from the paginated /api/leads?partnerId=unmatched. Admin-only.
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    return jsonOk(await unmatchedStateStats(scope));
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("unmatched_stats_failed", e instanceof Error ? e.message : "Failed to load unmatched stats", 500);
  }
}
```

- [ ] **Step 5: Delete the retired module + test**

```bash
git rm src/modules/leads/unmatched.ts tests/unit/unmatched-grouping.test.ts
```

- [ ] **Step 6: Run integration + typecheck + lint**

`pnpm vitest run tests/integration/unmatched-stats.test.ts --no-file-parallelism` → PASS. `pnpm run typecheck && pnpm run lint` → clean (the unmatched page still imports the deleted types — it is rewritten in Task 2; if typecheck fails only there, proceed to Task 2 before committing, OR commit backend + page together. To keep the tree compiling, do Task 2 before committing Task 1). **Commit Tasks 1+2 together** (the page rewrite removes the now-broken imports).

---

## Task 2: Unmatched page rewrite (state map + paginated table + id-only Assign)

**Files:**
- Rewrite: `src/app/unmatched/page.tsx`

**Interfaces:**
- Consumes: `unmatchedStateStats` payload `{ total, byState }` via `/api/leads/unmatched`; `/api/leads?partnerId=unmatched&page&pageSize` → `GlobalLeadsPage`; `CoverageMap`, `Pagination`, `RowOpenButton`, `Dialog`, `Select`, `Input`, code-split `LeadDialog`.

- [ ] **Step 1: Rewrite `src/app/unmatched/page.tsx`**

Full replacement. Stats row + state `CoverageMap` (built from `byState`) + a paginated `UnmatchedTable` (reusing the leads endpoint) + `AssignModal` on `Dialog` with **id-only** `assigningRef` state (F-80). Ref-id → `RowOpenButton` → code-split `LeadDialog` (F-55).

```tsx
"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  AppShell, Card, Badge, Button, Dialog, Select, Input, EmptyState, Skeleton,
  ToastProvider, useToast, CoverageMap, Table, THead, TBody, Th, Tr, Td, Pagination,
  RowOpenButton, DEFAULT_PAGE_SIZE,
} from "@/components";
import type { StateCoverage } from "@/modules/coverage/map";
import { US_HEX_STATES } from "@/lib/geo/us-hexgrid";

const LeadDialog = dynamic(() => import("../leads/lead-dialog").then((m) => m.LeadDialog), { ssr: false });

interface Partner { id: string; refId: string; name: string; color: string }
interface StateStats { total: number; byState: { state: string; count: number }[] }
interface LeadRow {
  refId: string; seller: string; address: string; city: string | null; state: string | null;
  zip: string | null; campaign: string | null; receivedAt: string;
}
interface LeadsPage { leads: LeadRow[]; page: number; pageSize: number; total: number }

const PARTNER_PLACEHOLDER = "__choose__";

function AssignModal({ refId, onClose }: { refId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roster = useQuery({ queryKey: ["partners"], queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners") });
  const [partnerId, setPartnerId] = React.useState(PARTNER_PLACEHOLDER);
  const [reason, setReason] = React.useState("");

  const assign = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/leads/${refId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ partnerId, reason: reason.trim() || undefined }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Assign failed.");
      return b as { message?: string };
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["unmatched"] });
      qc.invalidateQueries({ queryKey: ["unmatched-stats"] });
      qc.invalidateQueries({ queryKey: ["coverage"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.toast(b.message ?? "Lead assigned.", "success");
      onClose();
    },
    onError: (e: Error) => toast.toast(e.message, "danger"),
  });

  const chosen = partnerId !== PARTNER_PLACEHOLDER;
  return (
    <Dialog
      open
      onClose={onClose}
      title={<span className="num">Assign {refId}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => assign.mutate()} loading={assign.isPending} disabled={!chosen}>Assign lead</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Partner"
          value={partnerId}
          onValueChange={setPartnerId}
          options={[
            { value: PARTNER_PLACEHOLDER, label: "Choose a partner…" },
            ...(roster.data?.partners ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` })),
          ]}
        />
        <Input label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. covers this metro off-book" />
        <p className="text-xs text-text-3">Recorded in the activity log. The lead&apos;s original &ldquo;unmatched&rdquo; record is kept — history isn&apos;t rewritten (PRN-05).</p>
      </div>
    </Dialog>
  );
}

function UnmatchedInner() {
  const statsQ = useQuery({ queryKey: ["unmatched-stats"], queryFn: () => apiGet<StateStats>("/api/leads/unmatched") });
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  const [assigningRef, setAssigningRef] = React.useState<string | null>(null);
  const [openRef, setOpenRef] = React.useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["unmatched", "list", page, pageSize],
    queryFn: () => apiGet<LeadsPage>(`/api/leads?partnerId=unmatched&sort=received&dir=desc&page=${page}&pageSize=${pageSize}`),
  });

  const stats = statsQ.data;
  const gapMapStates: StateCoverage[] = React.useMemo(() => {
    const byCode = new Map((stats?.byState ?? []).filter((g) => g.state !== "—").map((g) => [g.state, g.count]));
    return US_HEX_STATES.map((h) => {
      const count = byCode.get(h.code);
      return count
        ? { code: h.code, name: h.name, partnerId: "gap", partnerName: `${count} unmatched lead${count === 1 ? "" : "s"}`, refId: null, color: "var(--warn)", leadCount: count, gap: true }
        : { code: h.code, name: h.name, partnerId: null, partnerName: null, refId: null, color: null, leadCount: 0, gap: false };
    });
  }, [stats]);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Unmatched</h1>
        <p className="mt-1 text-sm text-text-2">Leads no partner covers yet — hand each to a partner, or recruit one for the gap.</p>
      </div>

      {statsQ.isPending ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : statsQ.error ? (
        <Card><div className="p-6"><EmptyState title="Couldn't load unmatched leads" description={(statsQ.error as Error).message} /></div></Card>
      ) : (stats?.total ?? 0) === 0 ? (
        <Card><div className="p-8"><EmptyState title="Nothing unmatched — full coverage" description="Every lead you've processed reached a partner. New gaps will show up here." /></div></Card>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-soft bg-surface p-4 shadow-sm">
            <span className="text-sm text-text-2"><span className="num font-semibold text-text">{stats!.total}</span> unmatched across <span className="num font-semibold text-text">{stats!.byState.length}</span> state{stats!.byState.length === 1 ? "" : "s"}:</span>
            {stats!.byState.map((g) => (
              <span key={g.state} className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn">
                <span className="num">{g.state}</span> <span className="num">{g.count}</span>
              </span>
            ))}
          </div>

          {/* State map */}
          <section className="rounded-2xl border border-border-soft bg-surface p-5 shadow-sm">
            <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">Where the gaps are</h2>
            <CoverageMap states={gapMapStates} />
            <p className="mt-3 text-[.7rem] text-text-3">States with unmatched leads carry a warn ring. Recruiting a partner (or adding a state rule) there closes the gap.</p>
          </section>

          {/* Paginated table */}
          <Card>
            {listQ.isPending ? (
              <div className="flex flex-col gap-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            ) : listQ.error ? (
              <div className="p-6"><EmptyState title="Couldn't load the list" description={(listQ.error as Error).message} /></div>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Lead</Th><Th>Seller</Th><Th>Property</Th><Th>Source</Th>
                    <Th align="right">Received</Th><Th align="right">Assign</Th>
                  </Tr>
                </THead>
                <TBody>
                  {listQ.data!.leads.map((l) => (
                    <Tr key={l.refId} className="hover:bg-surface-2">
                      <Td><RowOpenButton className="text-xs" onClick={() => setOpenRef(l.refId)}>{l.refId}</RowOpenButton></Td>
                      <Td><span className="text-sm text-text">{l.seller}</span></Td>
                      <Td><span className="text-sm text-text-2">{l.address}</span> <span className="text-xs text-text-3">{[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span></span></Td>
                      <Td>{l.campaign ? <Badge variant="neutral">{l.campaign}</Badge> : <span className="text-xs text-text-3">—</span>}</Td>
                      <Td align="right"><span className="num text-xs text-text-3 tabular-nums">{new Date(l.receivedAt).toLocaleDateString()}</span></Td>
                      <Td align="right"><Button size="sm" variant="primary" onClick={() => setAssigningRef(l.refId)}>Assign →</Button></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          {listQ.data && listQ.data.total > 0 && (
            <Pagination page={listQ.data.page} pageSize={listQ.data.pageSize} total={listQ.data.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
          )}
        </div>
      )}

      {assigningRef && <AssignModal refId={assigningRef} onClose={() => setAssigningRef(null)} />}
      {openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </AppShell>
  );
}

export default function UnmatchedPage() {
  return (
    <ToastProvider>
      <UnmatchedInner />
    </ToastProvider>
  );
}
```

- [ ] **Step 2: Typecheck + lint** — `pnpm run typecheck && pnpm run lint` → clean.

- [ ] **Step 3: Commit Tasks 1+2 together**

```bash
git add src/modules/leads/queries.ts src/app/api/leads/unmatched/route.ts src/app/unmatched/page.tsx tests/integration/unmatched-stats.test.ts
git rm src/modules/leads/unmatched.ts tests/unit/unmatched-grouping.test.ts
git commit -m "feat(ws-4): unmatched inbox on bounded state-stats + reused paginated list, id-only Assign on Dialog, state map (F-11/F-80/F-55/F-56)"
```

---

## Task 3: Import detail — server-sourced stat, named void Dialog, dialog deep-link

**Files:**
- Modify: `src/app/imports/[ref]/page.tsx`

- [ ] **Step 1: F-75 — server-sourced Distributed stat**

In `RunView`, add `const distributed = distribution.reduce((s, d) => s + d.count, 0);` and change the Stat: `<Stat label="Distributed" value={distributed} foot={...} />`. Leave the `delivered` array for the per-partner table grouping only.

- [ ] **Step 2: Modal → Dialog + Textarea + F-65 (name the run, explain the reason rule)**

Replace the import of `Modal` with `Dialog`, add `Textarea`. Replace the void `<Modal …>` with `<Dialog …>`, name the run in the title/body, and use `Textarea`:

```tsx
      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={<span>Void <span className="num">{upload.refId}</span>?</span>}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={voidMut.isPending}>Cancel</Button>
            <Button variant="danger" onClick={() => voidMut.mutate()} loading={voidMut.isPending} disabled={reason.trim().length < 3}>Void import</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-text-2">
          Voiding <span className="num font-semibold text-text">{upload.refId}</span> ({upload.filename}) excludes its leads from future dedupe, analytics and exports. It stays in history as voided.
        </p>
        <Textarea
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. wrong file uploaded"
          hint="Required — at least 3 characters. Explains why this run was voided in the activity log."
          error={voidMut.isError ? (voidMut.error as Error).message : undefined}
        />
      </Dialog>
```

- [ ] **Step 3: F-55 — GroupRows ref-id opens LeadDialog**

The page needs dialog state. Add near the top of `ImportDetailPage` a code-split import:
```tsx
import dynamic from "next/dynamic";
const LeadDialog = dynamic(() => import("../../leads/lead-dialog").then((m) => m.LeadDialog), { ssr: false });
```
Lift an `openRef` state into `RunView` (it already holds state), pass a setter down to `GroupRows`, and render `<LeadDialog>` at the end of `RunView`'s fragment. In `GroupRows`, replace `<Link href={`/leads/${l.refId}`} …>{l.refId}</Link>` with `<RowOpenButton onClick={() => onOpen(l.refId)}>{l.refId}</RowOpenButton>` (add `RowOpenButton` to the `@/components` import and pass `onOpen` to `GroupRows`). Wrap `RunView`'s returned fragment so it can host `{openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}`. Remove the now-unused `Link` import if nothing else uses it (the "← Imports" link uses it — keep `Link`).

- [ ] **Step 4: Typecheck + lint** — clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/imports/[ref]/page.tsx"
git commit -m "feat(ws-4): import detail — server-sourced Distributed stat, named void Dialog + reason rule, dialog deep-link (F-75/F-65/F-55)"
```

---

## Self-Review
- F-11 (unbounded unmatched) → Task 1 (bounded stats) + Task 2 (reused paginated list) ✓
- State map / no county geo (F-56 facet) → Task 2 (`CoverageMap`) ✓
- Id-only Assign (F-80) → Task 2 (`assigningRef: string`) ✓
- F-55 both pages → Task 2 + Task 3 (`LeadDialog`) ✓
- F-75 server stat → Task 3 ✓ · F-65 named void + reason rule → Task 3 ✓
- Modal→Dialog, raw→primitives both pages → Tasks 2/3 ✓
- Placeholder scan: none. Types: `StateStats`/`LeadsPage`/`assigningRef` consistent.

## Execution Handoff
Inline (executing-plans). Order 1→2 (committed together to keep the tree compiling) → 3.
