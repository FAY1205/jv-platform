# WP-F.3 — Portal Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A partner-facing portal Dashboard (new landing tab) — a mobile hero with four partner-scoped
KPIs and the partner's own territory on the coverage map, mirroring the admin dashboard.

**Architecture:** Reuse `partnerPerformanceDetail` (already partner-scoped) for the stats and extend
its pure builder with `untouched`; a new pure `buildPartnerTerritory` produces an anonymized
(PRN-08) coverage payload for `CountyCoverageMap`. Two scoped, ToS-gated portal routes feed a new
`/portal/dashboard` page. A "Dashboard" tab is added to `PortalShell` and made the landing.

**Tech Stack:** TypeScript, Next.js 16, Drizzle + Postgres, TanStack Query, Vitest (jsdom), pnpm.

## Global Constraints

- **PRN-08:** both new routes go through `getServerScope` + `requireTosResponse`; every query is
  scoped to `scope.partnerId`. The territory payload NEVER carries another partner's name/ref/color.
- **PRN-15:** stats come from `src/modules/analytics` (reuse `partnerPerformanceDetail`); no route
  or component re-derives a number.
- **PRN-01:** `buildPartnerPerformance` + `buildPartnerTerritory` stay pure (`now` injected; no I/O).
- **PRN-12/PRN-14:** tokens only; the partner's swatch always pairs with name + JV-ref.
- **Commits:** implemented + verified incrementally, committed as a **single WP-F.3 commit** after
  the owner walkthrough (project WP rule) — not per task.
- **Test runner:** `pnpm exec vitest run <file> --no-file-parallelism`; full suite
  `pnpm test:unit -- --no-file-parallelism`; `pnpm typecheck` separately; lint changed files;
  integration serial with `.env.local` DATABASE_URL loaded.

---

### Task 1: `untouched` on the pure partner-performance builder

**Files:**
- Modify: `src/modules/analytics/partner-performance.ts` (`PartnerPerformance.stats`, `buildPartnerPerformance`)
- Test: `tests/unit/partner-performance.test.ts` (create or extend if present)

**Interfaces:**
- Produces: `PartnerPerformance.stats` gains `untouched: number`.

- [ ] **Step 1: Write the failing test** — `tests/unit/partner-performance.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildPartnerPerformance } from "@/modules/analytics/partner-performance";

const NOW = new Date("2026-07-12T00:00:00.000Z");

describe("ANA-02: partner performance untouched", () => {
  it("untouched = in-range leads with no first touch", () => {
    const facts = [
      { receivedAt: "2026-07-10T00:00:00.000Z", firstTouchAt: null, closedAt: null }, // untouched
      { receivedAt: "2026-07-10T00:00:00.000Z", firstTouchAt: "2026-07-11T00:00:00.000Z", closedAt: null }, // touched
      { receivedAt: "2020-01-01T00:00:00.000Z", firstTouchAt: null, closedAt: null }, // out of 30d range
    ];
    const r = buildPartnerPerformance("30d", NOW, facts);
    expect(r.stats.given).toBe(2);
    expect(r.stats.contacted).toBe(1);
    expect(r.stats.untouched).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm exec vitest run tests/unit/partner-performance.test.ts --no-file-parallelism`
Expected: FAIL — `untouched` is undefined.

- [ ] **Step 3: Implement** — in `src/modules/analytics/partner-performance.ts`

Add `untouched: number` to the `stats` field of `PartnerPerformance`:

```ts
  stats: { given: number; contacted: number; closed: number; untouched: number; avgContactHours: number | null };
```

In `buildPartnerPerformance`, add an accumulator + count and include it in `stats`:

```ts
  let given = 0;
  let contacted = 0;
  let closed = 0;
  let untouched = 0;
  let touchSumH = 0;
  for (const f of facts) {
    if (inRange(f.receivedAt, startMs, endMs)) {
      given += 1;
      if (f.firstTouchAt === null) untouched += 1; // no partner action yet (PRN-14 "get to these")
    }
    if (inRange(f.firstTouchAt, startMs, endMs)) {
      contacted += 1;
      touchSumH += (new Date(f.firstTouchAt!).getTime() - new Date(f.receivedAt).getTime()) / HOUR;
    }
    if (inRange(f.closedAt, startMs, endMs)) closed += 1;
  }
  const avgContactHours = contacted === 0 ? null : Math.round((touchSumH / contacted) * 10) / 10;
  const stats = { given, contacted, closed, untouched, avgContactHours };
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm exec vitest run tests/unit/partner-performance.test.ts --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Typecheck** (the admin partner-profile consumes `PartnerPerformance` — additive field is safe)

Run: `pnpm typecheck`
Expected: clean.

---

### Task 2: `buildPartnerTerritory` pure builder (PRN-08 anonymization)

**Files:**
- Create: `src/modules/coverage/partner-territory.ts`
- Test: `tests/unit/partner-territory.test.ts`

**Interfaces:**
- Consumes: `StateCoverage` (`src/modules/coverage/map.ts`), `US_HEX_STATES` (`src/lib/geo/us-hexgrid`).
- Produces:
  - `buildPartnerTerritory(input: { ownStates: readonly string[]; partner: { id: string; name: string; refId: string; color: string } }): PartnerTerritory`
  - `interface PartnerTerritory { states: StateCoverage[]; ownStateCount: number; partner: { name: string; refId: string; color: string } }`

- [ ] **Step 1: Write the failing test** — `tests/unit/partner-territory.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildPartnerTerritory } from "@/modules/coverage/partner-territory";

const PARTNER = { id: "p1", name: "Summit Partners", refId: "JV-091", color: "#C79A3E" };

describe("PTL/PRN-08: scoped partner territory", () => {
  const t = buildPartnerTerritory({ ownStates: ["WA", "OR", "ID"], partner: PARTNER });

  it("identifies the partner's own states with name + ref + color (PRN-14)", () => {
    const wa = t.states.find((s) => s.code === "WA")!;
    expect(wa).toMatchObject({ partnerId: "p1", partnerName: "Summit Partners", refId: "JV-091", color: "#C79A3E" });
    expect(t.ownStateCount).toBe(3);
  });

  it("PRN-08: every non-owned state is anonymized — no other partner's identity leaks", () => {
    for (const s of t.states.filter((x) => !["WA", "OR", "ID"].includes(x.code))) {
      expect(s.partnerId).toBeNull();
      expect(s.partnerName).toBeNull();
      expect(s.refId).toBeNull();
      expect(s.color).toBeNull();
      expect(s.gap).toBe(false); // portal never shows the coverage-gap hatch
    }
  });

  it("covers all 51 hex states (50 + DC)", () => {
    expect(t.states).toHaveLength(51);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm exec vitest run tests/unit/partner-territory.test.ts --no-file-parallelism`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/modules/coverage/partner-territory.ts`**

```ts
import { US_HEX_STATES } from "@/lib/geo/us-hexgrid";
import type { StateCoverage } from "./map";

// ─────────────────────────────────────────────────────────────────────────────
// Portal territory view model (WP-F.3, PTL). PURE. Scoped to ONE partner: the
// partner's own states carry their identity (name + JV-ref + color, PRN-14); EVERY
// other state is anonymized (null name/ref/color) so a partner can never see which
// states other partners cover (PRN-08). No coverage-gap hatch in the portal — gaps
// are an admin concern; here a non-owned state is simply "not yours".
// ─────────────────────────────────────────────────────────────────────────────

export interface PartnerTerritoryInput {
  ownStates: readonly string[]; // state codes this partner owns (from state_rules)
  partner: { id: string; name: string; refId: string; color: string };
}

export interface PartnerTerritory {
  states: StateCoverage[];
  ownStateCount: number;
  partner: { name: string; refId: string; color: string };
}

export function buildPartnerTerritory(input: PartnerTerritoryInput): PartnerTerritory {
  const owned = new Set(input.ownStates);
  const states: StateCoverage[] = US_HEX_STATES.map((hex) => {
    const mine = owned.has(hex.code);
    return {
      code: hex.code,
      name: hex.name,
      partnerId: mine ? input.partner.id : null,
      partnerName: mine ? input.partner.name : null,
      refId: mine ? input.partner.refId : null,
      color: mine ? input.partner.color : null,
      leadCount: 0,
      gap: false,
    };
  });
  const ownStateCount = states.filter((s) => s.partnerId !== null).length;
  return { states, ownStateCount, partner: { name: input.partner.name, refId: input.partner.refId, color: input.partner.color } };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm exec vitest run tests/unit/partner-territory.test.ts --no-file-parallelism`
Expected: PASS.

---

### Task 3: Scoped portal reads + API routes

**Files:**
- Modify: `src/modules/portal/queries.ts` (add `partnerDashboardStats`, `partnerTerritory`)
- Create: `src/app/api/portal/dashboard/route.ts`, `src/app/api/portal/territory/route.ts`
- Test: `tests/integration/portal-dashboard.test.ts`

**Interfaces:**
- Consumes: `partnerPerformanceDetail` (Task 1 field), `buildPartnerTerritory` (Task 2).
- Produces:
  - `partnerDashboardStats(scope, range): Promise<{ range: RangeKey; leads: number; contacted: number; closed: number; untouched: number }>`
  - `partnerTerritory(scope): Promise<PartnerTerritory>`

- [ ] **Step 1: Write the failing integration test** — `tests/integration/portal-dashboard.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { partnerDashboardStats, partnerTerritory } from "@/modules/portal/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-portal-dash-wpf3";

suite("WP-F.3: portal dashboard reads (PTL, PRN-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let otherId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [schema.leadStatusHistory, schema.leads, schema.uploads, schema.stateRules, schema.partners, schema.tenants]) {
      const col = tbl === schema.tenants ? schema.tenants.id : (tbl as { tenantId: typeof schema.leads.tenantId }).tenantId;
      await db.delete(tbl).where(inArray(col, tids));
    }
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "PDash", slug: SLUG }).returning({ id: schema.tenants.id });
    const [me] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-091", name: "Summit", color: "#C79A3E", status: "active" }).returning({ id: schema.partners.id });
    const [other] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-204", name: "Northshore", color: "#5B7A9E", status: "active" }).returning({ id: schema.partners.id });
    otherId = other.id;
    await db.insert(schema.stateRules).values([
      { tenantId: t.id, state: "WA", partnerId: me.id },
      { tenantId: t.id, state: "CA", partnerId: other.id }, // NOT mine
    ]);
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-050", filename: "w.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values([
      { tenantId: t.id, refId: "LD-26-1", uploadId: up.id, dedupeKey: "1|98001", rawJson: {}, partnerId: me.id, state: "WA", mlsStatus: "kept" },
      { tenantId: t.id, refId: "LD-26-2", uploadId: up.id, dedupeKey: "2|90001", rawJson: {}, partnerId: otherId, state: "CA", mlsStatus: "kept" }, // other partner's
    ]);
    scope = { tenantId: t.id, role: "partner", userId: randomUUID(), partnerId: me.id };
  });

  afterAll(async () => { await cleanup(); await client.end(); });

  it("PRN-08: stats count only the caller's own leads", async () => {
    const s = await partnerDashboardStats(scope, "all");
    expect(s.leads).toBe(1); // only LD-26-1 (mine), not the other partner's
    expect(s.untouched).toBe(1);
  });

  it("PRN-08: territory identifies my state (WA) and anonymizes everyone else (CA)", async () => {
    const t = await partnerTerritory(scope);
    const wa = t.states.find((x) => x.code === "WA")!;
    const ca = t.states.find((x) => x.code === "CA")!;
    expect(wa.partnerName).toBe("Summit");
    expect(ca.partnerName).toBeNull(); // never leak Northshore
    expect(ca.color).toBeNull();
    expect(t.ownStateCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `set -a && . ./.env.local && set +a && pnpm exec vitest run tests/integration/portal-dashboard.test.ts --no-file-parallelism`
Expected: FAIL — `partnerDashboardStats`/`partnerTerritory` not exported.

- [ ] **Step 3: Add the reads to `src/modules/portal/queries.ts`**

Add imports at the top:

```ts
import { partnerPerformanceDetail } from "../analytics/partner-performance";
import { buildPartnerTerritory, type PartnerTerritory } from "../coverage/partner-territory";
import type { RangeKey } from "../analytics/ranges";
```

Append the two reads:

```ts
export interface PartnerDashboardStats {
  range: RangeKey;
  leads: number;
  contacted: number;
  closed: number;
  untouched: number;
}

/** WP-F.3: the caller's OWN dashboard KPIs (PRN-08). Numbers come from analytics (PRN-15). */
export async function partnerDashboardStats(scope: ScopeContext, range: RangeKey): Promise<PartnerDashboardStats> {
  if (!scope.partnerId) return { range, leads: 0, contacted: 0, closed: 0, untouched: 0 };
  const perf = await partnerPerformanceDetail(scope, scope.partnerId, range);
  return { range, leads: perf.stats.given, contacted: perf.stats.contacted, closed: perf.stats.closed, untouched: perf.stats.untouched };
}

/** WP-F.3: the caller's OWN state territory, everyone else anonymized (PRN-08). */
export async function partnerTerritory(scope: ScopeContext): Promise<PartnerTerritory> {
  const db = getDb();
  const empty = { id: "", name: "", refId: "", color: "#000000" };
  if (!scope.partnerId) return buildPartnerTerritory({ ownStates: [], partner: empty });
  const [partner] = await db
    .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
    .from(schema.partners)
    .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, scope.partnerId)));
  const rules = await db
    .select({ state: schema.stateRules.state })
    .from(schema.stateRules)
    .where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, scope.partnerId)));
  return buildPartnerTerritory({ ownStates: rules.map((r) => r.state), partner: partner ?? empty });
}
```

- [ ] **Step 4: Create the routes**

`src/app/api/portal/dashboard/route.ts`:

```ts
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { partnerDashboardStats } from "@/modules/portal/queries";
import { RANGE_KEYS, type RangeKey } from "@/modules/analytics/ranges";
import { jsonOk, jsonServerError } from "@/lib/http";

// GET /api/portal/dashboard?range=<RangeKey> — the caller's own KPIs (PTL, PRN-08).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    const raw = new URL(request.url).searchParams.get("range") ?? "30d";
    const range: RangeKey = (RANGE_KEYS as readonly string[]).includes(raw) ? (raw as RangeKey) : "30d";
    return jsonOk(await partnerDashboardStats(scope, range));
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("portal_dashboard_failed", "Failed to load your dashboard.", { message: e instanceof Error ? e.message : String(e) });
  }
}
```

`src/app/api/portal/territory/route.ts`:

```ts
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { partnerTerritory } from "@/modules/portal/queries";
import { jsonOk, jsonServerError } from "@/lib/http";

// GET /api/portal/territory — the caller's own state territory, anonymized elsewhere (PTL, PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    return jsonOk(await partnerTerritory(scope));
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("portal_territory_failed", "Failed to load your territory.", { message: e instanceof Error ? e.message : String(e) });
  }
}
```

- [ ] **Step 5: Run the integration test + typecheck**

Run: `set -a && . ./.env.local && set +a && pnpm exec vitest run tests/integration/portal-dashboard.test.ts --no-file-parallelism`
Then: `pnpm typecheck`
Expected: PASS / clean. (If `schema.stateRules` column names differ, adjust the select — verify in `src/db/schema.ts`.)

---

### Task 4: Navigation — Dashboard tab + landing repoint

**Files:**
- Modify: `src/components/PortalShell.tsx` (add tab; logo href)
- Modify: `src/app/portal/login/page.tsx` (default `next`)
- Test: `tests/unit/components/portal-shell.test.tsx` (create or extend)

**Interfaces:** none exported; nav wiring only.

- [ ] **Step 1: Write the failing test** — `tests/unit/components/portal-shell.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalShell } from "@/components/PortalShell";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/dashboard" }));
vi.mock("@/lib/preferences", () => ({ useApplyTheme: () => {} }));

describe("WP-F.3: PortalShell nav", () => {
  it("shows a Dashboard tab, current on /portal/dashboard", () => {
    render(<PortalShell><div>x</div></PortalShell>);
    const dash = screen.getByRole("link", { name: /dashboard/i });
    expect(dash).toHaveAttribute("href", "/portal/dashboard");
    expect(dash).toHaveAttribute("aria-current", "page");
  });
});
```
(If `NotificationBell`/`ThemeToggle` need mocking to render in jsdom, mock them the way existing portal component tests do — check `tests/unit/components/*` for the established pattern.)

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm exec vitest run tests/unit/components/portal-shell.test.tsx --no-file-parallelism`
Expected: FAIL — no Dashboard tab.

- [ ] **Step 3: Add the tab + repoint the logo** in `src/components/PortalShell.tsx`

Prepend a Dashboard tab to `TABS` (leftmost):

```ts
const TABS: Tab[] = [
  {
    href: "/portal/dashboard",
    label: "Dashboard",
    active: (p) => p === "/portal/dashboard",
    icon: <svg {...stroke} className="h-[22px] w-[22px]"><path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z" /></svg>,
  },
  // …existing Leads / Activity / Account tabs unchanged…
];
```

Repoint the top-bar logo `href` from `/portal/leads` to `/portal/dashboard` (the `<Link href="/portal/leads">` wrapping the brand mark).

- [ ] **Step 4: Repoint the post-login landing** in `src/app/portal/login/page.tsx`

Change the default: `const next = params.get("next") || "/portal/dashboard";` (was `"/portal"`).

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm exec vitest run tests/unit/components/portal-shell.test.tsx --no-file-parallelism`
Then: `pnpm typecheck`
Expected: PASS / clean.

---

### Task 5: The Portal Dashboard page

**Files:**
- Create: `src/app/portal/dashboard/page.tsx` (server: ToS gate → client body)
- Create: `src/app/portal/dashboard/portal-dashboard.tsx` (client hero)

**Interfaces:** consumes `/api/portal/dashboard` + `/api/portal/territory` (Task 3).

- [ ] **Step 1: Create the server page** `src/app/portal/dashboard/page.tsx` (mirrors `src/app/portal/page.tsx`'s ToS gate)

```tsx
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance } from "@/lib/legal/tos";
import { PortalDashboard } from "./portal-dashboard";

// WP-F.3: the portal landing. Server-side ToS gate before the hero renders.
export const dynamic = "force-dynamic";

export default async function PortalDashboardPage() {
  let userId: string;
  try {
    userId = (await getServerScope()).userId;
  } catch {
    redirect("/portal/login");
  }
  const accepted = await latestTosVersion(getDb(), userId);
  if (needsTosAcceptance(accepted)) redirect("/portal/tos");
  return (
    <main className="mx-auto w-full flex-1 p-4">
      <PortalDashboard />
    </main>
  );
}
```

- [ ] **Step 2: Create the client hero** `src/app/portal/dashboard/portal-dashboard.tsx`

Mobile-first hero: eyebrow + range control + headline + four KPI tiles + the scoped territory map,
with loading/error/empty states. Reuse the token classes from the admin dashboard (13px chrome
floor; no sub-13px). The map is lazy + client-only.

```tsx
"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { SegmentedControl, Skeleton, EmptyState, Tooltip } from "@/components";
import type { RangeKey } from "@/modules/analytics/ranges";
import type { PartnerTerritory } from "@/modules/coverage/partner-territory";
import type { PartnerDashboardStats } from "@/modules/portal/queries";

const CountyCoverageMap = dynamic(() => import("@/components/CountyCoverageMap").then((m) => m.CountyCoverageMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[220px] w-full rounded-lg" />,
});

const RANGE_SEGMENTS: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "12mo", label: "12mo" },
  { value: "all", label: "All" },
];
const label13 = "text-[.8125rem]";

function Kpi({ label, value, tip }: { label: string; value: number; tip: string }) {
  return (
    <div className="bg-surface px-3 py-3">
      <div className="font-display text-2xl font-semibold leading-none tabular-nums text-text">{value.toLocaleString()}</div>
      <div className={`mt-1 font-medium uppercase tracking-[.05em] text-text-3 ${label13}`}>
        <Tooltip content={tip}>
          <span tabIndex={0} className="cursor-help rounded underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink">{label}</span>
        </Tooltip>
      </div>
    </div>
  );
}

export function PortalDashboard() {
  const [range, setRange] = React.useState<RangeKey>("30d");
  const stats = useQuery({ queryKey: ["portal-dashboard", range], queryFn: () => apiGet<PartnerDashboardStats>(`/api/portal/dashboard?range=${range}`) });
  const territory = useQuery({ queryKey: ["portal-territory"], queryFn: () => apiGet<PartnerTerritory>("/api/portal/territory") });

  const s = stats.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-semibold uppercase tracking-[.08em] text-text-3 ${label13}`}>Your dashboard</span>
        <SegmentedControl<RangeKey> ariaLabel="Time range" value={range} onValueChange={setRange} options={RANGE_SEGMENTS} />
      </div>

      {stats.error ? (
        <EmptyState title="Couldn't load your dashboard" description={(stats.error as Error).message} />
      ) : (
        <>
          <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-balance text-text">
            {!s ? <Skeleton className="h-8 w-3/4" /> : s.leads === 0 ? (
              "No leads in your territory yet."
            ) : (
              <>
                <span className="num">{s.leads.toLocaleString()}</span> lead{s.leads === 1 ? "" : "s"}
                {territory.data ? <> across your <span className="num">{territory.data.ownStateCount}</span>-state territory</> : null}.
              </>
            )}
          </h1>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
            <Kpi label="Leads" value={s?.leads ?? 0} tip="Kept leads routed to you in the selected range." />
            <Kpi label="New" value={s?.untouched ?? 0} tip="Leads you've received but not yet actioned — get to these first." />
            <Kpi label="Contacted" value={s?.contacted ?? 0} tip="Leads you actioned (a status change or note) in the selected range." />
            <Kpi label="Closed" value={s?.closed ?? 0} tip="Leads whose latest status became Closed in the selected range." />
          </div>

          <section className="overflow-hidden rounded-2xl border border-border-soft bg-surface-2 p-3">
            <div className="relative aspect-[960/600] w-full">
              {territory.data ? (
                <CountyCoverageMap
                  states={territory.data.states}
                  selectedPartnerId={territory.data.states.find((x) => x.partnerId)?.partnerId ?? null}
                  caption={{ title: territory.data.partner.name, subtitle: `${territory.data.partner.refId} · ${territory.data.ownStateCount} state${territory.data.ownStateCount === 1 ? "" : "s"}` }}
                  interactive={false}
                />
              ) : territory.isError ? (
                <div role="status" className="grid h-full place-items-center text-sm text-text-3">Territory map unavailable.</div>
              ) : (
                <Skeleton className="h-full w-full rounded-lg" />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify the map renders non-owned states neutrally (not gap-hatched)**

Read `src/components/CountyCoverageMap.tsx` fill logic: confirm a state with `color: null, gap: false`
renders as a plain neutral fill (the hatch is keyed on `gap === true`). If a `color: null` state
falls through to the amber hatch, adjust `buildPartnerTerritory` or the map so non-owned states are
plain neutral. (Portal must not show gap alarms.) Confirm in the walkthrough screenshot.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck`
Then: `pnpm exec eslint src/app/portal/dashboard/page.tsx src/app/portal/dashboard/portal-dashboard.tsx`
Expected: clean.

---

### Task 6: Owner walkthrough — throwaway preview route (NOT committed)

**Files:**
- Create (throwaway, delete before Task 7): `src/app/gallery/portal-dashboard/page.tsx`

- [ ] **Step 1: Build the preview** rendering the REAL `PortalDashboard` inside a fixed-width
  (~400px) frame with a QueryClient whose two queries are seeded with mock data (a real partner's
  own states + KPI numbers), so no auth is needed. Screenshot at 375px + desktop, both themes, via
  Playwright against the running dev server (`http://localhost:3000/gallery/portal-dashboard`).

- [ ] **Step 2: Confirm** own territory lit + all other states neutral (no competitor names), the four
  KPIs, the headline, and — via a separate check — that `PortalShell` shows the 4-tab bar with
  Dashboard current. Present screenshots to the owner; get the go-ahead.

- [ ] **Step 3: DELETE** the throwaway route; confirm `git status` shows no `gallery/portal-dashboard`.

---

### Task 7: Self-audit + single WP-F.3 commit

- [ ] **Step 1: PLAYBOOK §6** checklist — print it filled in the summary.

- [ ] **Step 2: Review agents on the diff** (parallel): `pr-reviewer`, `audit-tenancy` (the partner
  scoping of both routes + the territory anonymization — the headline risk), `audit-frontend-arch`
  (TanStack discipline, client/server split, no server data in component state), `audit-a11y`
  (map role="img", KPI tooltip semantics, touch targets ≥44px). Triage + fix.

- [ ] **Step 3: Final green gate**

Run: `pnpm typecheck`
Then: `pnpm test:unit -- --no-file-parallelism`
Then: `set -a && . ./.env.local && set +a && pnpm exec vitest run tests/integration/portal-dashboard.test.ts --no-file-parallelism`
Then: lint the changed files.
Expected: all green (note any pre-existing unrelated reds, e.g. audit-immutability).

- [ ] **Step 4: Single WP-F.3 commit** (includes spec + plan)

```bash
git add -A
git commit -m "feat(wp-f.3): portal Dashboard — partner-scoped hero + own-territory map"
```

Body: new Dashboard landing tab; reuse partnerPerformanceDetail (+ pure `untouched`); new pure
`buildPartnerTerritory` (PRN-08 anonymized); two scoped ToS-gated routes; nav + landing repoint.

---

## Self-Review (against the spec)

- **Spec §3 nav** → Task 4. **§4.1 stats reuse + untouched** → Tasks 1 + 3. **§4.2 territory builder +
  route** → Tasks 2 + 3. **§5 page** → Task 5. **§6 tests** → each task is test-first (ANA-02 untouched,
  PRN-08 territory anonymization + route scoping, nav render). **§7 walkthrough** → Task 6. **§8 audits**
  → Task 7.
- **Placeholder scan:** none — every code step carries full code. Two flagged build-time checks (map
  neutral-fill rendering in Task 5 Step 3; jsdom mock pattern in Task 4 Step 1) resolve against
  existing code, not TBDs.
- **Type consistency:** `PartnerPerformance.stats.untouched` (Task 1) is read by `partnerDashboardStats`
  (Task 3); `PartnerTerritory` shape (Task 2) is returned by `partnerTerritory` (Task 3) and consumed
  by the page (Task 5); `PartnerDashboardStats` (Task 3) typed in the page query.
- **Known risk:** `schema.stateRules` column names — Task 3 Step 5 says verify against the schema
  (the golden test uses `{ state, partnerId }`, so they exist; confirm in Drizzle).
