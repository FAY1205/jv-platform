# WS-2 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the admin dashboard onto rolling-window time filters with all numbers aggregated in SQL bounded by range, Recharts trend + source donut, a progress-bar-free partner table with a single-sourced Avg Contact, an honest error banner, and the D5 Delivered→Distributed vocabulary rename.

**Architecture:** A new pure `ranges.ts` computes the rolling window + prior window + bucket granularity and formats Avg Contact. `dashboardData(scope, range)` is rewritten to aggregate entirely in SQL (drizzle query-builder `sql<T>` fragments for flat GROUP BYs; `db.execute(sql\`…\`)` for the trend `generate_series` and the partner-facts history CTE), tenant-scoped via `tenantWhere`. The page is rebuilt on WS-1 primitives (Radix `Select`, `LineChart`, `DonutChart`, `Tooltip`).

**Tech Stack:** Next.js App Router, TanStack Query, drizzle-orm + postgres-js, Recharts (WS-1 wrappers), Zod, Vitest.

## Global Constraints

- PRN-08: every query tenant-scoped through `lib/scope.ts` (`tenantWhere`); never service role without a tenant filter. Raw SQL embeds `tenantWhere(table, scope)` (no table alias so the generated `"table"."tenant_id"` resolves).
- PRN-12: no hardcoded hex/font/product-name in components — semantic tokens only. Chart series colors come from token CSS vars (`var(--brand)` etc.).
- PRN-14: every chart series/segment named in legend AND tooltip — never color alone.
- PRN-15: computed statistics live only in `src/modules/analytics`; never re-derived in the UI.
- Effective owner = `coalesce(manual_partner_id, partner_id)` — the WS-0 rule; defines "Distributed".
- Zod-validate every API input; uniform error envelope `{code,message,traceId}` unchanged.
- Test names carry requirement IDs, e.g. `it("ANA-03: Avg Contact excludes untouched leads")`.
- Small commits; run the relevant suite green before each commit. No new dependencies.
- Scope: WS-2 only. Do NOT delete the now-dead `analyticsOverview`/`periodSummary`/`periods.ts` calendar helpers (WS-9). Do NOT touch `performance.ts` internals (leave its passing unit tests; its functions simply lose their last caller).

**Verification commands:**
- Single unit file: `pnpm vitest run tests/unit/<file>.test.ts`
- Single integration file: `pnpm vitest run tests/integration/dashboard.test.ts --no-file-parallelism`
- Full unit suite: `pnpm test:unit` · Full gate: `pnpm check` (typecheck + lint + all tests)

---

## Task 1: D5 rename — Delivered → Distributed (non-dashboard text + tests)

Faithful terminology swap on user-facing text; each label keeps the exact number it maps to today. The dashboard page itself is rebuilt in Task 4 (uses "Distributed" natively), so it is excluded here.

**Files:**
- Modify: `src/modules/notify/digests.ts:61`
- Modify: `src/modules/notify/outbox.ts:200`
- Modify: `src/modules/export/render.ts:207`
- Modify: `src/modules/notify/prefs.ts:27`
- Modify: `src/app/imports/[ref]/page.tsx:145,191`
- Modify: `src/app/partners/[id]/page.tsx:162,220`
- Test: `tests/unit/digests.test.ts` (add assertion), `tests/unit/export-render.test.ts` (new)

**Interfaces:**
- Consumes: `renderExport(leads, partners, summary, options)` → `Promise<Uint8Array>` (existing).
- Produces: no new exports; user-facing strings change only.

- [ ] **Step 1: Update the digest unit test to assert the new label (write failing)**

In `tests/unit/digests.test.ts`, inside the `buildAdminRunSummary` test (after line 52), add:

```ts
    expect(out.body).toContain("Distributed (kept):");
    expect(out.body).not.toContain("Delivered");
```

- [ ] **Step 2: Run it, expect fail**

Run: `pnpm vitest run tests/unit/digests.test.ts`
Expected: FAIL — body still contains "Delivered (kept):".

- [ ] **Step 3: Rename in `digests.ts`**

`src/modules/notify/digests.ts` line 61 — change the label and trim two trailing spaces so the value column stays aligned:

```ts
    `  Distributed (kept):  ${s.kept}\n` +
```

- [ ] **Step 4: Run it, expect pass**

Run: `pnpm vitest run tests/unit/digests.test.ts` → PASS.

- [ ] **Step 5: Rename the remaining text surfaces**

`src/modules/notify/outbox.ts` line 200:
```ts
      body: `${input.summary.kept} distributed · ${input.summary.removed} removed · ${input.summary.unmatched} unmatched.`,
```

`src/modules/notify/prefs.ts` line 27:
```ts
  { role: "partner", key: "new_leads", label: "New leads distributed to you" },
```

`src/modules/export/render.ts` line 207:
```ts
  sum.addRow(["Partner", "Distributed"]).eachCell((c) => (c.font = { bold: true }));
```

`src/app/imports/[ref]/page.tsx` line 145 — `label="Delivered"` → `label="Distributed"`; line 191 — the caption `delivered` word → `distributed`:
```tsx
            <Stat label="Distributed" value={delivered.length} foot={`to ${distribution.length} ${distribution.length === 1 ? "partner" : "partners"}`} />
```
```tsx
          <span className="text-xs text-text-3"><span className="num">{delivered.length}</span> distributed</span>
```
(The local `const delivered` variable name may stay — it is internal, not user-facing.)

`src/app/partners/[id]/page.tsx` line 162 and 220:
```tsx
            <Stat label="Leads distributed" value={partner.leadCount} />
```
```tsx
              <p className="py-4 text-center text-sm text-text-3">No leads distributed to this partner yet.</p>
```

- [ ] **Step 6: Add an export-render unit test for the sheet header (write failing first if authoring incrementally, else co-commit)**

Create `tests/unit/export-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { renderExport, type ExportLead, type PartnerInfo } from "@/modules/export/render";
import type { RunSummary } from "@/modules/analytics/run-summary";

describe("renderExport — Run_Summary sheet (EXP-04, D5)", () => {
  it("D5: the per-partner totals header reads 'Distributed', not 'Delivered'", async () => {
    const partners = new Map<string, PartnerInfo>([
      ["p1", { id: "p1", name: "Alpha", refId: "JV-001", color: "#f4c95d" }],
    ]);
    const summary: RunSummary = { total: 2, kept: 1, removed: 1, unmatched: 0, previouslyMatched: 0, perPartner: [{ partnerId: "p1", count: 1 }] };
    const leads: ExportLead[] = [];
    const bytes = await renderExport(leads, partners, summary, { colorCoding: false });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Run_Summary")!;
    const headers: string[] = [];
    sheet.eachRow((row) => row.eachCell((c) => headers.push(String(c.value))));
    expect(headers).toContain("Distributed");
    expect(headers).not.toContain("Delivered");
  });
});
```

- [ ] **Step 7: Run the affected suites**

Run: `pnpm vitest run tests/unit/digests.test.ts tests/unit/export-render.test.ts` → PASS.
Then `pnpm test:unit` → all green (confirms no other unit test asserted the old strings; `analytics-overview`/`analytics-periods`/`performance`/`run-summary` assert internal fields, not this text).

- [ ] **Step 8: Commit**

```bash
git add src/modules/notify/digests.ts src/modules/notify/outbox.ts src/modules/notify/prefs.ts src/modules/export/render.ts "src/app/imports/[ref]/page.tsx" "src/app/partners/[id]/page.tsx" tests/unit/digests.test.ts tests/unit/export-render.test.ts
git commit -m "feat(ws-2): D5 Delivered→Distributed across digests, notifications, export text (D5)"
```

---

## Task 2: `ranges.ts` — pure rolling-window math + formatters

**Files:**
- Create: `src/modules/analytics/ranges.ts`
- Test: `tests/unit/ranges.test.ts`

**Interfaces:**
- Produces:
  - `type RangeKey = "7d" | "30d" | "12mo" | "all"`; `RANGE_KEYS: readonly RangeKey[]`.
  - `type Bucket = "day" | "month"`.
  - `interface RangeWindow { start: Date; end: Date; prevStart: Date | null; prevEnd: Date | null; bucket: Bucket }`.
  - `rangeWindow(key: RangeKey, now: Date): RangeWindow`.
  - `formatContactTime(hours: number | null): string`.
  - `deltaOf(cur: number, prev: number | null): number | null`.
  - `AVG_CONTACT_DEFINITION: string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ranges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rangeWindow, formatContactTime, deltaOf, AVG_CONTACT_DEFINITION } from "@/modules/analytics/ranges";

const NOW = new Date("2026-07-10T12:00:00Z");

describe("rangeWindow (ANA-01 rolling windows)", () => {
  it("ANA-01: 7d window is the trailing 7 days, daily buckets, prior = preceding 7 days", () => {
    const w = rangeWindow("7d", NOW);
    expect(w.end.toISOString()).toBe(NOW.toISOString());
    expect(w.start.toISOString()).toBe(new Date("2026-07-03T12:00:00Z").toISOString());
    expect(w.bucket).toBe("day");
    expect(w.prevStart!.toISOString()).toBe(new Date("2026-06-26T12:00:00Z").toISOString());
    expect(w.prevEnd!.toISOString()).toBe(w.start.toISOString());
  });

  it("ANA-01: 30d window is the trailing 30 days, daily buckets", () => {
    const w = rangeWindow("30d", NOW);
    expect(w.start.toISOString()).toBe(new Date("2026-06-10T12:00:00Z").toISOString());
    expect(w.bucket).toBe("day");
    expect(w.prevStart!.toISOString()).toBe(new Date("2026-05-11T12:00:00Z").toISOString());
  });

  it("ANA-01: 12mo window is the trailing 12 months (UTC month math), monthly buckets", () => {
    const w = rangeWindow("12mo", NOW);
    expect(w.start.toISOString()).toBe(new Date("2025-07-10T12:00:00Z").toISOString());
    expect(w.bucket).toBe("month");
    expect(w.prevStart!.toISOString()).toBe(new Date("2024-07-10T12:00:00Z").toISOString());
    expect(w.prevEnd!.toISOString()).toBe(w.start.toISOString());
  });

  it("ANA-01: all-time starts at the epoch, monthly buckets, and has no prior window", () => {
    const w = rangeWindow("all", NOW);
    expect(w.start.getTime()).toBe(0);
    expect(w.bucket).toBe("month");
    expect(w.prevStart).toBeNull();
    expect(w.prevEnd).toBeNull();
  });
});

describe("formatContactTime (ANA-03)", () => {
  it("ANA-03: null → em dash", () => expect(formatContactTime(null)).toBe("—"));
  it("ANA-03: sub-48h shows hours with one decimal", () => expect(formatContactTime(3.2)).toBe("3.2h"));
  it("ANA-03: 48h+ shows days with one decimal", () => expect(formatContactTime(50)).toBe("2.1d"));
});

describe("deltaOf", () => {
  it("returns null when prior is null (all-time)", () => expect(deltaOf(5, null)).toBeNull());
  it("returns cur - prev otherwise", () => expect(deltaOf(5, 2)).toBe(3));
});

it("AVG_CONTACT_DEFINITION is a non-empty human sentence", () => {
  expect(AVG_CONTACT_DEFINITION.length).toBeGreaterThan(20);
});
```

- [ ] **Step 2: Run tests, expect fail**

Run: `pnpm vitest run tests/unit/ranges.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `ranges.ts`**

Create `src/modules/analytics/ranges.ts`:

```ts
// Rolling-window analytics time model (ANA-01). PURE — `now` is always injected,
// never read (mirrors PRN-01 discipline); the single home of these numbers (PRN-15).
// Windows are trailing spans ending at `now`; the prior window is the immediately
// preceding equal-length span. Replaces the calendar-period model (periods.ts) on
// the dashboard; that path is retired in WS-9.

export type RangeKey = "7d" | "30d" | "12mo" | "all";
export const RANGE_KEYS: readonly RangeKey[] = ["7d", "30d", "12mo", "all"];

export type Bucket = "day" | "month";

export interface RangeWindow {
  start: Date;
  end: Date;
  prevStart: Date | null;
  prevEnd: Date | null;
  bucket: Bucket;
}

const DAY = 86_400_000;

/** Subtract `n` whole UTC months from `d`, preserving day-of-month clamped to month length. */
function minusMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() - n);
  return r;
}

export function rangeWindow(key: RangeKey, now: Date): RangeWindow {
  const end = new Date(now.getTime());
  if (key === "all") {
    return { start: new Date(0), end, prevStart: null, prevEnd: null, bucket: "month" };
  }
  if (key === "7d" || key === "30d") {
    const days = key === "7d" ? 7 : 30;
    const start = new Date(end.getTime() - days * DAY);
    const prevStart = new Date(start.getTime() - days * DAY);
    return { start, end, prevStart, prevEnd: start, bucket: "day" };
  }
  // 12mo
  const start = minusMonths(end, 12);
  const prevStart = minusMonths(end, 24);
  return { start, end, prevStart, prevEnd: start, bucket: "month" };
}

/** ANA-03: Avg Contact display. `—` when no contacted leads; hours under 2 days,
 *  otherwise days — each to one decimal. The single formatter for this figure. */
export function formatContactTime(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

export function deltaOf(cur: number, prev: number | null): number | null {
  return prev === null ? null : cur - prev;
}

/** ANA-03 / F-64: the one human definition of Avg Contact, shown in the header tooltip. */
export const AVG_CONTACT_DEFINITION =
  "Average time from a lead being distributed to a partner until that partner's first action " +
  "(a status change or note), measured only over leads acted on in the selected range. " +
  "Untouched leads are excluded — they are counted under Untouched.";
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run tests/unit/ranges.test.ts` → PASS. (If the 12mo assertion drifts by a day due to month clamping, adjust the expected literal to what `setUTCMonth` yields for 2026-07-10 minus 12 — it is 2025-07-10.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/analytics/ranges.ts tests/unit/ranges.test.ts
git commit -m "feat(ws-2): pure rolling-window range module + Avg Contact formatter (ANA-01/03)"
```

---

## Task 3: SQL `dashboardData` rewrite + Zod route + integration tests

**Files:**
- Modify: `src/modules/analytics/queries.ts` (rewrite `dashboardData` + its `DashboardData`/`DashboardPartnerPerf` types; remove now-unused imports)
- Modify: `src/app/api/dashboard/route.ts` (`?period=` → `?range=`, Zod)
- Test: `tests/integration/dashboard.test.ts` (new)

**Interfaces:**
- Consumes: `rangeWindow`, `RangeKey`, `RANGE_KEYS` from `ranges.ts`; `tenantWhere`, `ScopeContext` from `lib/scope`; `DEFAULT_STATUS` from `modules/portal/statuses`.
- Produces:

```ts
export interface DashboardStat { value: number; delta: number | null }
export interface DashboardPartnerRow {
  partnerId: string; name: string; refId: string; color: string;
  given: number; untouched: number; contacted: number; closed: number;
  avgContactHours: number | null;
}
export interface DashboardSourceRow {
  campaign: string; imported: number; removed: number; closed: number; removalRate: number;
}
export interface DashboardData {
  range: { key: RangeKey; start: string; end: string; bucket: "day" | "month" };
  stats: { leadsIn: DashboardStat; distributed: DashboardStat; removed: DashboardStat; unmatched: DashboardStat; closed: DashboardStat };
  trend: { bucketStart: string; leadsIn: number; distributed: number; unmatched: number }[];
  partners: DashboardPartnerRow[];
  sources: DashboardSourceRow[];
}
export async function dashboardData(scope: ScopeContext, range: RangeKey): Promise<DashboardData>;
```

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/dashboard.test.ts`. Mirrors the `coverage.test.ts` harness (direct postgres, slug-scoped cleanup). Seeds two leads distributed to a partner (one inside the 30d window, one 90 days old), one unmatched kept lead in-window, one removed lead in-window; a re-routed lead (`partnerId=A, manualPartnerId=B`); and status history giving one contact + one close in-window.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { dashboardData } from "@/modules/analytics/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-dashboard-ws2";

suite("WS-2: dashboard SQL aggregation (ANA-01/02/03, F-10)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let partnerA: string;
  let partnerB: string;
  let uploadId: string;

  const DAY = 86_400_000;
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * DAY);

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [schema.leadStatusHistory, schema.leads, schema.uploads, schema.partners, schema.auditLog]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  async function seedLead(opts: {
    campaign?: string | null; mlsStatus?: "kept" | "removed";
    partnerId?: string | null; manualPartnerId?: string | null; createdAt: Date;
  }): Promise<string> {
    const [l] = await db.insert(schema.leads).values({
      tenantId: scope.tenantId, refId: `LD-26-${Math.floor(Math.random() * 100000)}`,
      uploadId, dedupeKey: randomUUID(), rawJson: {},
      campaign: opts.campaign ?? "Facebook", mlsStatus: opts.mlsStatus ?? "kept",
      partnerId: opts.partnerId ?? null, manualPartnerId: opts.manualPartnerId ?? null,
      matchMethod: opts.partnerId ? "zip" : "none", createdAt: opts.createdAt,
    }).returning({ id: schema.leads.id });
    return l.id;
  }

  async function seedStatus(leadId: string, status: string, at: Date) {
    await db.insert(schema.leadStatusHistory).values({ tenantId: scope.tenantId, leadId, status, createdAt: at });
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Dash", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [a] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const [b] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "Bravo", color: "#b9c4d6", status: "active" }).returning({ id: schema.partners.id });
    partnerA = a.id; partnerB = b.id;
    const [u] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-001", status: "processed", filename: "x.csv" }).returning({ id: schema.uploads.id });
    uploadId = u.id;

    // In-window (30d) distributed lead to A, contacted +2h, closed at day 3.
    const l1 = await seedLead({ partnerId: partnerA, createdAt: daysAgo(5) });
    await seedStatus(l1, "Contacted", new Date(daysAgo(5).getTime() + 2 * 3600_000));
    await seedStatus(l1, "Closed", daysAgo(2));
    // Old (90d) distributed lead to A — outside every window except all-time.
    await seedLead({ partnerId: partnerA, createdAt: daysAgo(90) });
    // In-window unmatched kept lead.
    await seedLead({ partnerId: null, createdAt: daysAgo(4) });
    // In-window removed lead.
    await seedLead({ mlsStatus: "removed", partnerId: partnerA, createdAt: daysAgo(4) });
    // Re-routed lead: pipeline A, manual B → effective owner is B.
    await seedLead({ partnerId: partnerA, manualPartnerId: partnerB, createdAt: daysAgo(6) });
  });

  afterAll(async () => { await cleanup(); await client.end(); });

  it("F-10: 30d stats bound by range — old lead excluded, in-window counted", async () => {
    const d = await dashboardData(scope, "30d");
    // Leads in (30d): l1, unmatched, removed, re-routed = 4 (90d lead excluded).
    expect(d.stats.leadsIn.value).toBe(4);
    // Distributed = kept + effective owner present: l1 + re-routed = 2.
    expect(d.stats.distributed.value).toBe(2);
    expect(d.stats.unmatched.value).toBe(1);
    expect(d.stats.removed.value).toBe(1);
    expect(d.stats.closed.value).toBe(1);
  });

  it("F-01/ASN-04: Distributed uses the effective owner — re-routed lead counts for the manual partner", async () => {
    const d = await dashboardData(scope, "all");
    const bravo = d.partners.find((p) => p.partnerId === partnerB);
    const alpha = d.partners.find((p) => p.partnerId === partnerA);
    expect(bravo?.given).toBe(1); // the re-routed lead
    // Alpha given (all-time, kept, effective owner = A): l1 + old = 2 (re-routed excluded).
    expect(alpha?.given).toBe(2);
  });

  it("ANA-03: Avg Contact is set for a contacted lead and untouched leads are excluded", async () => {
    const d = await dashboardData(scope, "30d");
    const alpha = d.partners.find((p) => p.partnerId === partnerA)!;
    expect(alpha.contacted).toBe(1);
    expect(alpha.avgContactHours).toBeGreaterThan(1.5);
    expect(alpha.avgContactHours).toBeLessThan(2.5);
    expect(alpha.untouched).toBeGreaterThanOrEqual(0);
  });

  it("ANA-01: trend buckets are zero-filled and daily for 30d", async () => {
    const d = await dashboardData(scope, "30d");
    expect(d.range.bucket).toBe("day");
    expect(d.trend.length).toBeGreaterThan(1);
    expect(d.trend.reduce((s, b) => s + b.leadsIn, 0)).toBe(4);
  });

  it("ANA-02: source rows carry imported/removed/removalRate", async () => {
    const d = await dashboardData(scope, "30d");
    const fb = d.sources.find((s) => s.campaign === "Facebook")!;
    expect(fb.imported).toBe(4);
    expect(fb.removed).toBe(1);
    expect(fb.removalRate).toBeCloseTo(0.25, 5);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `pnpm vitest run tests/integration/dashboard.test.ts --no-file-parallelism`
Expected: FAIL (`dashboardData` returns the old shape — `d.stats` undefined). If `DATABASE_URL` is unset the suite skips; ensure `.env.local` is present.

- [ ] **Step 3: Rewrite `dashboardData` in `queries.ts`**

Replace the existing `DashboardPartnerPerf`/`DashboardData` interfaces and `dashboardData` function (lines ~130–224) with the block below. Also update the imports at the top: remove `buildPeriodSummary`, `bucketByWeek`, `periodRange`, `type PeriodSummary`, `type WeekBucket`, `partnerPerformance`, `sourcePerformance`, `type PartnerPerf`, `type SourcePerf`, `currentStatus` — but KEEP `buildPeriodSummary`/`bucketByWeek`/`campaignQuality`/`buildAnalytics` if still referenced by the retained `analyticsOverview`/`periodSummary` functions (they are — leave those two functions and their imports intact). Add `import { rangeWindow, deltaOf, type RangeKey } from "./ranges";` and keep `DEFAULT_STATUS`.

```ts
export interface DashboardStat {
  value: number;
  delta: number | null;
}
export interface DashboardPartnerRow {
  partnerId: string;
  name: string;
  refId: string;
  color: string;
  given: number;
  untouched: number;
  contacted: number;
  closed: number;
  avgContactHours: number | null;
}
export interface DashboardSourceRow {
  campaign: string;
  imported: number;
  removed: number;
  closed: number;
  removalRate: number;
}
export interface DashboardData {
  range: { key: RangeKey; start: string; end: string; bucket: "day" | "month" };
  stats: {
    leadsIn: DashboardStat;
    distributed: DashboardStat;
    removed: DashboardStat;
    unmatched: DashboardStat;
    closed: DashboardStat;
  };
  trend: { bucketStart: string; leadsIn: number; distributed: number; unmatched: number }[];
  partners: DashboardPartnerRow[];
  sources: DashboardSourceRow[];
}

/** Every dashboard number, aggregated in SQL bounded by the selected range (F-10,
 *  PRN-15). `now` is stamped once here; the pure window math lives in ranges.ts.
 *  Distributed uses the effective owner `coalesce(manual_partner_id, partner_id)`
 *  (the WS-0 / ASN-04 rule). Raw SQL embeds `tenantWhere` so scoping stays on the
 *  guard (PRN-08); no table alias is used so the generated column resolves. */
export async function dashboardData(scope: ScopeContext, range: RangeKey): Promise<DashboardData> {
  const db = getDb();
  const w = rangeWindow(range, new Date());
  const start = w.start.toISOString();
  const end = w.end.toISOString();
  // Prior window: use the current start as a no-match sentinel when there is none
  // (all-time), so prior counts read 0; deltas are nulled in JS via deltaOf.
  const pStart = (w.prevStart ?? w.start).toISOString();
  const pEnd = (w.prevEnd ?? w.start).toISOString();
  const noPrior = w.prevStart === null;
  const interval = w.bucket === "day" ? "1 day" : "1 month";
  const trunc = w.bucket; // 'day' | 'month' — from a fixed enum, safe to inline
  const leadTenant = tenantWhere(schema.leads, scope);
  const histTenant = tenantWhere(schema.leadStatusHistory, scope);

  const [statRow, closedRow, trendRows, partnerRows, partnerMeta, sourceRows] = await Promise.all([
    // ── Flat lead-count stats: current + prior windows in one pass ──
    db.execute<{ li: number; di: number; rm: number; un: number; pli: number; pdi: number; prm: number; pun: number }>(sql`
      select
        count(*) filter (where created_at >= ${start} and created_at < ${end})::int as li,
        count(*) filter (where created_at >= ${start} and created_at < ${end} and mls_status='kept' and coalesce(manual_partner_id, partner_id) is not null)::int as di,
        count(*) filter (where created_at >= ${start} and created_at < ${end} and mls_status='removed')::int as rm,
        count(*) filter (where created_at >= ${start} and created_at < ${end} and mls_status='kept' and coalesce(manual_partner_id, partner_id) is null)::int as un,
        count(*) filter (where created_at >= ${pStart} and created_at < ${pEnd})::int as pli,
        count(*) filter (where created_at >= ${pStart} and created_at < ${pEnd} and mls_status='kept' and coalesce(manual_partner_id, partner_id) is not null)::int as pdi,
        count(*) filter (where created_at >= ${pStart} and created_at < ${pEnd} and mls_status='removed')::int as prm,
        count(*) filter (where created_at >= ${pStart} and created_at < ${pEnd} and mls_status='kept' and coalesce(manual_partner_id, partner_id) is null)::int as pun
      from leads where ${leadTenant} and deleted_at is null
    `),
    // ── Closed = leads whose LATEST Closed status event lands in the window ──
    db.execute<{ c: number; pc: number }>(sql`
      with closed as (
        select lead_id, max(created_at) as closed_at
        from lead_status_history where ${histTenant} and status = 'Closed' group by lead_id
      )
      select
        count(*) filter (where closed_at >= ${start} and closed_at < ${end})::int as c,
        count(*) filter (where closed_at >= ${pStart} and closed_at < ${pEnd})::int as pc
      from closed
    `),
    // ── Trend: zero-filled buckets between first & last in-window lead ──
    db.execute<{ bucket_start: string; leads_in: number; distributed: number; unmatched: number }>(sql`
      with bounds as (
        select date_trunc(${trunc}, min(created_at)) as lo, date_trunc(${trunc}, max(created_at)) as hi
        from leads where ${leadTenant} and deleted_at is null and created_at >= ${start} and created_at < ${end}
      ),
      buckets as (
        select generate_series(bounds.lo, bounds.hi, ${sql.raw(`interval '${interval}'`)}) as b from bounds where bounds.lo is not null
      ),
      agg as (
        select date_trunc(${trunc}, created_at) as b,
          count(*)::int as leads_in,
          count(*) filter (where mls_status='kept' and coalesce(manual_partner_id, partner_id) is not null)::int as distributed,
          count(*) filter (where mls_status='kept' and coalesce(manual_partner_id, partner_id) is null)::int as unmatched
        from leads where ${leadTenant} and deleted_at is null and created_at >= ${start} and created_at < ${end}
        group by 1
      )
      select buckets.b::text as bucket_start,
        coalesce(agg.leads_in, 0)::int as leads_in,
        coalesce(agg.distributed, 0)::int as distributed,
        coalesce(agg.unmatched, 0)::int as unmatched
      from buckets left join agg on agg.b = buckets.b order by buckets.b
    `),
    // ── Partner performance: per-lead history facts → per effective-partner aggregates ──
    db.execute<{ pid: string; given: number; untouched: number; contacted: number; closed: number; avg_contact_hours: number | null }>(sql`
      with hist as (
        select lead_id,
          min(created_at) filter (where status <> ${DEFAULT_STATUS}) as first_touch_at,
          max(created_at) filter (where status = 'Closed') as closed_at,
          (array_agg(status order by created_at desc))[1] as current_status
        from lead_status_history where ${histTenant} group by lead_id
      ),
      facts as (
        select coalesce(leads.manual_partner_id, leads.partner_id) as pid,
          leads.created_at as received_at,
          hist.first_touch_at, hist.closed_at,
          coalesce(hist.current_status, ${DEFAULT_STATUS}) as current_status
        from leads left join hist on hist.lead_id = leads.id
        where ${leadTenant} and leads.deleted_at is null and leads.mls_status='kept'
          and coalesce(leads.manual_partner_id, leads.partner_id) is not null
      )
      select pid,
        count(*) filter (where received_at >= ${start} and received_at < ${end})::int as given,
        count(*) filter (where received_at >= ${start} and received_at < ${end} and current_status = ${DEFAULT_STATUS})::int as untouched,
        count(*) filter (where first_touch_at >= ${start} and first_touch_at < ${end})::int as contacted,
        count(*) filter (where closed_at >= ${start} and closed_at < ${end})::int as closed,
        avg(extract(epoch from (first_touch_at - received_at)) / 3600.0)
          filter (where first_touch_at >= ${start} and first_touch_at < ${end}) as avg_contact_hours
      from facts group by pid
      order by given desc, contacted desc, pid
    `),
    // ── Partner metadata for name/ref/color ──
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt))),
    // ── Source performance ──
    db.execute<{ campaign: string; imported: number; removed: number; closed: number }>(sql`
      with closed as (
        select lead_id, max(created_at) filter (where status='Closed') as closed_at
        from lead_status_history where ${histTenant} group by lead_id
      )
      select coalesce(nullif(trim(leads.campaign), ''), 'Unattributed') as campaign,
        count(*) filter (where leads.created_at >= ${start} and leads.created_at < ${end})::int as imported,
        count(*) filter (where leads.created_at >= ${start} and leads.created_at < ${end} and leads.mls_status='removed')::int as removed,
        count(*) filter (where closed.closed_at >= ${start} and closed.closed_at < ${end})::int as closed
      from leads left join closed on closed.lead_id = leads.id
      where ${leadTenant} and leads.deleted_at is null
      group by 1 order by imported desc, campaign
    `),
  ]);

  const s = (statRow as unknown as Record<string, number>[])[0] ?? {};
  const cl = (closedRow as unknown as Record<string, number>[])[0] ?? { c: 0, pc: 0 };
  const stat = (cur: number, prev: number): DashboardStat => ({
    value: Number(cur ?? 0),
    delta: noPrior ? null : deltaOf(Number(cur ?? 0), Number(prev ?? 0)),
  });

  const metaById = new Map((partnerMeta as { id: string; name: string; refId: string; color: string }[]).map((p) => [p.id, p]));
  const partners: DashboardPartnerRow[] = (partnerRows as unknown as { pid: string; given: number; untouched: number; contacted: number; closed: number; avg_contact_hours: number | null }[]).map((r) => {
    const meta = metaById.get(r.pid);
    return {
      partnerId: r.pid,
      name: meta?.name ?? "Unknown partner",
      refId: meta?.refId ?? "—",
      color: meta?.color ?? "var(--text-3)",
      given: Number(r.given),
      untouched: Number(r.untouched),
      contacted: Number(r.contacted),
      closed: Number(r.closed),
      avgContactHours: r.avg_contact_hours === null ? null : Math.round(Number(r.avg_contact_hours) * 10) / 10,
    };
  });

  const sources: DashboardSourceRow[] = (sourceRows as unknown as { campaign: string; imported: number; removed: number; closed: number }[]).map((r) => ({
    campaign: r.campaign,
    imported: Number(r.imported),
    removed: Number(r.removed),
    closed: Number(r.closed),
    removalRate: Number(r.imported) === 0 ? 0 : Number(r.removed) / Number(r.imported),
  }));

  const trend = (trendRows as unknown as { bucket_start: string; leads_in: number; distributed: number; unmatched: number }[]).map((r) => ({
    bucketStart: r.bucket_start,
    leadsIn: Number(r.leads_in),
    distributed: Number(r.distributed),
    unmatched: Number(r.unmatched),
  }));

  return {
    range: { key: range, start, end, bucket: w.bucket },
    stats: {
      leadsIn: stat(Number(s.li ?? 0), Number(s.pli ?? 0)),
      distributed: stat(Number(s.di ?? 0), Number(s.pdi ?? 0)),
      removed: stat(Number(s.rm ?? 0), Number(s.prm ?? 0)),
      unmatched: stat(Number(s.un ?? 0), Number(s.pun ?? 0)),
      closed: stat(Number(cl.c ?? 0), Number(cl.pc ?? 0)),
    },
    trend,
    partners,
    sources,
  };
}
```

Note: keep the top-of-file imports `and`, `eq`, `isNull`, `sql` (already present). If `eq` becomes unused after removing the old body, drop it to satisfy lint.

- [ ] **Step 4: Update the API route to `?range=` with Zod**

Rewrite `src/app/api/dashboard/route.ts`:

```ts
import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { dashboardData } from "@/modules/analytics/queries";
import { RANGE_KEYS, type RangeKey } from "@/modules/analytics/ranges";
import { jsonOk, jsonError } from "@/lib/http";

const RangeSchema = z.enum(RANGE_KEYS as unknown as [RangeKey, ...RangeKey[]]).catch("30d");

// The unified dashboard payload (ANA-01/02). Admin-only; scoped via the guard
// (PRN-08). Unknown/invalid ?range= degrades to "30d".
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const range = RangeSchema.parse(new URL(request.url).searchParams.get("range"));
    return jsonOk(await dashboardData(scope, range));
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("dashboard_failed", e instanceof Error ? e.message : "Failed to load dashboard", 500);
  }
}
```

- [ ] **Step 5: Run the integration test, expect pass**

Run: `pnpm vitest run tests/integration/dashboard.test.ts --no-file-parallelism` → PASS. Debug SQL against the assertions if any count is off (common cause: `date_trunc` unit passed unquoted — it is bound as a string param here, which Postgres accepts for `date_trunc(text, ts)`).

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm run typecheck && pnpm run lint` → clean. Fix any unused-import errors in `queries.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/modules/analytics/queries.ts src/app/api/dashboard/route.ts tests/integration/dashboard.test.ts
git commit -m "feat(ws-2): SQL-aggregate dashboard bounded by rolling range + Zod route (F-10, ANA-01/02/03)"
```

---

## Task 4: Dashboard UI rebuild on WS-1 primitives + Recharts

**Files:**
- Modify (rewrite): `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `DashboardData` (Task 3), `Select` from `@/components`, `LineChart`/`DonutChart` from `@/components`, `Tooltip` from `@/components`, `formatContactTime`/`AVG_CONTACT_DEFINITION`/`RangeKey` from `@/modules/analytics/ranges`, `apiGet` from `@/lib/api`.

- [ ] **Step 1: Confirm the primitives are exported from the barrel**

Run: `pnpm vitest run tests/unit/ranges.test.ts` is unaffected; check `grep -n "Select\|LineChart\|DonutChart\|Tooltip" src/components/index.ts`. If any is missing from the barrel, import it directly from its file. (WS-1 shipped them; the gallery uses them.)

- [ ] **Step 2: Rewrite `src/app/dashboard/page.tsx`**

Full replacement. Range filter via `Select`; 5 KPI cards with deltas; Recharts `LineChart` (3 series); progress-bar-free partner table with header `Tooltip`s and `formatContactTime`; source table + `DonutChart`; honest coverage error banner. All colors via tokens (PRN-12). Keep `AppShell`, `PartnerTag`, `EmptyState`, `Skeleton`.

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { AppShell, PartnerTag, EmptyState, Skeleton, Select, LineChart, DonutChart, Tooltip } from "@/components";
import { formatContactTime, AVG_CONTACT_DEFINITION, type RangeKey } from "@/modules/analytics/ranges";
import type { DashboardData } from "@/modules/analytics/queries";

interface CoverageSummary { gapCount: number; unmatchedLeadCount: number }

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "12mo", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";
const pct = (n: number) => `${Math.round(n * 100)}%`;

// Donut palette from tokens (PRN-12); cycled per source. Names always accompany
// color in the legend + tooltip (PRN-14).
const SOURCE_COLORS = ["var(--brand)", "var(--warn)", "var(--danger)", "var(--text-3)", "var(--brand-strong)"];

function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="num text-[.66rem] text-text-3">all time</span>;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
  return <span className="num text-[.66rem] text-text-3">{arrow} {delta === 0 ? "same" : Math.abs(delta)} vs prior</span>;
}

function Stat({ label, value, delta, tone, tip }: { label: string; value: React.ReactNode; delta: number | null; tone?: "brand" | "danger" | "warn"; tip?: string }) {
  const color = tone === "brand" ? "text-brand" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-text";
  const header = (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-text-2">
      {label}
      {tip && <span className="cursor-help text-text-3" aria-hidden="true">ⓘ</span>}
    </span>
  );
  return (
    <div className="relative flex flex-col gap-1.5 px-5 py-4 first:pl-1 [&+&]:before:absolute [&+&]:before:left-0 [&+&]:before:top-4 [&+&]:before:bottom-4 [&+&]:before:w-px [&+&]:before:bg-border">
      {tip ? <Tooltip content={tip}>{header}</Tooltip> : header}
      <span className={`font-display text-3xl font-semibold leading-none tracking-tight tabular-nums ${color}`}>{value}</span>
      <Delta delta={delta} />
    </div>
  );
}

function HeaderTip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip content={tip}>
      <span className="inline-flex cursor-help items-center gap-1">{label}<span className="text-text-3" aria-hidden="true">ⓘ</span></span>
    </Tooltip>
  );
}

export default function DashboardPage() {
  const [range, setRange] = React.useState<RangeKey>("30d");
  const dash = useQuery({ queryKey: ["dashboard", range], queryFn: () => apiGet<DashboardData>(`/api/dashboard?range=${range}`) });
  const coverage = useQuery({ queryKey: ["coverage"], queryFn: () => apiGet<CoverageSummary>("/api/coverage") });

  const d = dash.data;
  const rangeLabel = RANGES.find((r) => r.value === range)!.label.toLowerCase();

  // Honest attention banner (F-21): an errored coverage query renders an explicit
  // error item — never a masked "all clear".
  const attention: { text: string; href: string; tone: "warn" | "danger" }[] = [];
  if (coverage.data) {
    if (coverage.data.unmatchedLeadCount > 0) attention.push({ text: `${coverage.data.unmatchedLeadCount} unmatched lead${coverage.data.unmatchedLeadCount === 1 ? "" : "s"} need a partner`, href: "/unmatched", tone: "danger" });
    if (coverage.data.gapCount > 0) attention.push({ text: `${coverage.data.gapCount} coverage gap${coverage.data.gapCount === 1 ? "" : "s"} — leads from unowned states`, href: "/coverage", tone: "warn" });
  }

  const donutData = (d?.sources ?? [])
    .filter((s) => s.removed > 0)
    .map((s, i) => ({ name: s.campaign, value: s.removed, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }));

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-text-2">Your business at a glance — {rangeLabel}.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-44"><Select ariaLabel="Time range" value={range} onValueChange={(v) => setRange(v as RangeKey)} options={RANGES} /></div>
          <Link href="/upload" className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_-8px_var(--brand)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-brand-strong active:translate-y-0 active:scale-[.98]">
            <span className="text-base leading-none">+</span> New import
          </Link>
        </div>
      </div>

      {coverage.isError && (
        <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-danger-soft p-4 text-sm" style={{ background: "var(--danger-soft)" }}>
          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
          <span className="font-medium text-text">Couldn't check for attention items.</span>
          <button type="button" onClick={() => coverage.refetch()} className="ml-auto text-xs font-semibold text-text-2 hover:underline">Retry</button>
        </div>
      )}

      {dash.isPending ? (
        <div className="flex flex-col gap-5"><Skeleton className="h-28" /><Skeleton className="h-64 rounded-2xl" /></div>
      ) : dash.error ? (
        <div className={panel}><EmptyState title="Couldn't load the dashboard" description={(dash.error as Error).message} /></div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          {attention.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-warn-soft p-4" style={{ background: "var(--warn-soft)" }}>
              {attention.map((a) => (
                <Link key={a.text} href={a.href} className="group flex items-center gap-2.5 text-sm">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${a.tone === "danger" ? "bg-danger" : "bg-warn"}`} />
                  <span className="font-medium text-text">{a.text}</span>
                  <span className="ml-auto text-xs font-semibold text-text-2 group-hover:underline">Review →</span>
                </Link>
              ))}
            </div>
          )}

          {/* KPI band — 5 range-bounded cards with prior-window deltas */}
          <div className="grid grid-cols-2 rounded-2xl border border-border-soft bg-surface p-1 shadow-sm sm:grid-cols-5">
            <Stat label="Leads in" value={d!.stats.leadsIn.value} delta={d!.stats.leadsIn.delta} />
            <Stat label="Distributed" value={d!.stats.distributed.value} delta={d!.stats.distributed.delta} tone="brand" tip="Kept leads assigned to a partner (by routing or manual assignment) in the selected range." />
            <Stat label="Removed · MLS" value={d!.stats.removed.value} delta={d!.stats.removed.delta} tone="danger" tip="Leads discarded as already MLS-listed in the selected range." />
            <Stat label="Unmatched" value={d!.stats.unmatched.value} delta={d!.stats.unmatched.delta} tone="warn" tip="Kept leads with no partner in the selected range." />
            <Stat label="Closed" value={d!.stats.closed.value} delta={d!.stats.closed.delta} tip="Leads whose latest status became Closed in the selected range." />
          </div>

          {/* Trend */}
          <section className={panel}>
            <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">Lead flow <span className="text-[.7rem] font-normal text-text-3">· {rangeLabel}</span></h2>
            {d!.trend.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-3">No leads in this range.</p>
            ) : (
              <LineChart
                data={d!.trend.map((b) => ({ x: b.bucketStart.slice(0, 10), "Leads in": b.leadsIn, Distributed: b.distributed, Unmatched: b.unmatched }))}
                xKey="x"
                series={[
                  { key: "Leads in", name: "Leads in", color: "var(--text-2)" },
                  { key: "Distributed", name: "Distributed", color: "var(--brand)" },
                  { key: "Unmatched", name: "Unmatched", color: "var(--warn)" },
                ]}
              />
            )}
          </section>

          {/* Partner performance — no progress bars */}
          <section className={panel}>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Partner performance</h2>
              <span className="text-[.7rem] text-text-3">{rangeLabel} · counts by when each event happened</span>
            </div>
            {d!.partners.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads distributed {rangeLabel}.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[.65rem] font-semibold uppercase tracking-wider text-text-3">
                      <th className="py-2 pr-3 font-semibold">Partner</th>
                      <th className="px-2 py-2 text-right font-semibold">Given</th>
                      <th className="px-2 py-2 text-right font-semibold"><HeaderTip label="Untouched" tip="Given leads still at status New (no partner action yet)." /></th>
                      <th className="px-2 py-2 text-right font-semibold"><HeaderTip label="Contacted" tip="Leads whose first partner action fell in the selected range." /></th>
                      <th className="px-2 py-2 text-right font-semibold"><HeaderTip label="Avg contact" tip={AVG_CONTACT_DEFINITION} /></th>
                      <th className="px-2 py-2 text-right font-semibold">Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d!.partners.map((p) => (
                      <tr key={p.partnerId} className="border-b border-border-soft transition-colors last:border-0 hover:bg-surface-2">
                        <td className="py-2.5 pr-3">
                          <Link href={`/partners/${p.partnerId}`} className="transition-opacity hover:opacity-70"><PartnerTag size="sm" name={p.name} color={p.color} refId={p.refId} /></Link>
                        </td>
                        <td className="px-2 py-2.5 text-right"><span className="num font-medium tabular-nums">{p.given}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className={`num tabular-nums ${p.untouched > 0 ? "font-semibold text-warn" : "text-text-3"}`}>{p.untouched || "—"}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className="num tabular-nums text-text-2">{p.contacted || "—"}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className="num tabular-nums text-text-2">{formatContactTime(p.avgContactHours)}</span></td>
                        <td className="px-2 py-2.5 text-right"><span className={`num tabular-nums ${p.closed > 0 ? "font-semibold text-brand" : "text-text-3"}`}>{p.closed || "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Lead source performance + donut */}
          <section className={panel}>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Lead source performance</h2>
              <span className="text-[.7rem] text-text-3">removal rate = share discarded as MLS-listed</span>
            </div>
            {d!.sources.length === 0 ? (
              <p className="py-4 text-sm text-text-3">No leads imported {rangeLabel}.</p>
            ) : (
              <div className="mt-3 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[.65rem] font-semibold uppercase tracking-wider text-text-3">
                        <th className="py-2 pr-3 font-semibold">Source</th>
                        <th className="px-2 py-2 text-right font-semibold">Imported</th>
                        <th className="px-2 py-2 text-right font-semibold">Removed</th>
                        <th className="px-2 py-2 text-right font-semibold">Removal %</th>
                        <th className="px-2 py-2 text-right font-semibold">Closed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d!.sources.map((s) => {
                        const bad = s.removalRate >= 0.5, warn = s.removalRate >= 0.3;
                        return (
                          <tr key={s.campaign} className="border-b border-border-soft last:border-0 hover:bg-surface-2">
                            <td className="py-2.5 pr-3 font-medium text-text">{s.campaign}</td>
                            <td className="px-2 py-2.5 text-right num tabular-nums text-text-2">{s.imported}</td>
                            <td className="px-2 py-2.5 text-right num tabular-nums text-text-2">{s.removed}</td>
                            <td className={`px-2 py-2.5 text-right num tabular-nums font-semibold ${bad ? "text-danger" : warn ? "text-warn" : "text-text-2"}`}>{pct(s.removalRate)}</td>
                            <td className="px-2 py-2.5 text-right num tabular-nums text-text-2">{s.closed || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {donutData.length > 0 && (
                  <div className="flex flex-col items-center justify-center">
                    <h3 className="mb-2 self-start text-xs font-semibold text-text-2">Removed leads by source</h3>
                    <DonutChart data={donutData} centerLabel="removed" />
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck` → clean. (If `@/components` barrel lacks `Select`/`LineChart`/`DonutChart`/`Tooltip`, add them to `src/components/index.ts` or import from the file paths directly.)

- [ ] **Step 4: Verify in the running app**

Start the dev server (`preview_start` with the `dev` config, or `pnpm dev` on :3000). Sign in as admin, open `/dashboard`. Verify with preview tools:
- The range `Select` switches windows; chart + cards + tables all change.
- Trend line shows 3 named series in the legend; tooltip names each series.
- Partner table has no progress bars; Avg Contact header tooltip shows the definition on hover/focus.
- Source donut renders with a labeled legend + center total.
- Temporarily break `/api/coverage` (or throttle offline) to confirm the honest error banner replaces the silent "all clear". Restore.
Capture a screenshot for the summary.

- [ ] **Step 5: Full gate + commit**

Run: `pnpm check` → typecheck + lint + all tests green.

```bash
git add src/app/dashboard/page.tsx src/components/index.ts
git commit -m "feat(ws-2): rebuild dashboard on WS-1 primitives + Recharts, honest error banner (F-10/F-21/F-64)"
```

---

## Self-Review

**Spec coverage** (design §A–F):
- Rolling windows + buckets + prior-window deltas → Task 2 (`ranges.ts`) + Task 3 (SQL). ✓
- SQL aggregation bounded by range (F-10) → Task 3. ✓
- 5 KPI cards incl. Closed, deltas → Task 3 (stats) + Task 4 (band). ✓
- Trend LineChart 3 series (PRN-14) → Task 4. ✓
- Partner table, no progress bars, right-aligned tabular → Task 4. ✓
- Avg Contact single source + tooltip (ANA-03/F-64) → Task 2 (`formatContactTime`/`AVG_CONTACT_DEFINITION`) + Task 3 (SQL) + Task 4 (header tip). ✓
- Source table + donut → Task 3 (sources) + Task 4 (DonutChart). ✓
- Honest error banner (F-21) → Task 4 (coverage `isError`). ✓
- D5 rename + tests → Task 1. ✓
- Zod route `?range=` → Task 3. ✓

**Placeholder scan:** none — every step carries concrete code/commands.

**Type consistency:** `DashboardData` shape identical across Task 3 (produced) and Task 4 (consumed): `stats.{leadsIn,distributed,removed,unmatched,closed}` each `{value,delta}`; `partners[].avgContactHours`; `trend[].bucketStart`. `RangeKey` from `ranges.ts` used in the route, page, and test. ✓

## Execution Handoff

Executing **inline** (executing-plans): the SQL shape, DTO, and UI are tightly coupled, so one context implements all four tasks with a checkpoint (suite green) at each commit. Task order: 1 (D5) → 2 (ranges) → 3 (SQL+route) → 4 (UI).
