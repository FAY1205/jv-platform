import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { listLeads } from "@/modules/leads/queries";
import { LeadsQuerySchema } from "@/modules/leads/schema";
import { updateLeadStatus } from "@/modules/portal/status-update";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-leads-list-ws3";

suite("WS-3: listLeads pagination (FEP-03)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "LL", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [u] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-001", status: "processed", filename: "x.csv" }).returning({ id: schema.uploads.id });
    for (let i = 0; i < 25; i++) {
      await db.insert(schema.leads).values({
        tenantId: t.id, refId: `LD-26-${10000 + i}`, uploadId: u.id, dedupeKey: randomUUID(), rawJson: {},
        mlsStatus: "kept", matchMethod: "none", createdAt: new Date(Date.now() - i * 60_000),
      });
    }
  });

  afterAll(async () => { await cleanup(); await client.end(); });

  it("FEP-03: pageSize=10 returns 10 rows with the full total", async () => {
    const q = LeadsQuerySchema.parse({ pageSize: "10", page: "1" });
    const res = await listLeads(scope, q);
    expect(res.leads).toHaveLength(10);
    expect(res.pageSize).toBe(10);
    expect(res.total).toBe(25);
  });

  it("FEP-03: page 3 at pageSize=10 returns the last 5 rows", async () => {
    const q = LeadsQuerySchema.parse({ pageSize: "10", page: "3" });
    const res = await listLeads(scope, q);
    expect(res.leads).toHaveLength(5);
  });
});

// F1-03 (WP-F1 fold-in, audit-tenancy F-1): the admin `sort=status`/`sort=modified`
// paths exercise the two admin correlated `lead_status_history` subqueries
// (`latestStatus`/`latestAt` in modules/leads/queries.ts). F1-01 (portal) proved the
// portal subquery is scoped; this proves the admin ones are too — two tenants, an
// overlapping "Closed" status and a leading city, mirroring
// tests/integration/portal-leads-sort-filter.test.ts's isolation shape.
suite("F1-03: listLeads sort=status/sort=modified are tenant-scoped (ADR-0013 defence-in-depth, WP-F1)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  const SLUG_A = "test-leads-list-f1-03-a";
  const SLUG_B = "test-leads-list-f1-03-b";

  async function cleanupSlugs(slugs: string[]) {
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, slugs));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanupSlugs([SLUG_A, SLUG_B]);

    // Tenant A — the admin scope under test.
    const [tA] = await db.insert(schema.tenants).values({ name: "F1-03 Tenant A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    id.tenantA = tA.id;
    id.adminA = randomUUID();
    await db.insert(schema.users).values({ id: id.adminA, tenantId: tA.id, email: "admin@f103a.test", role: "admin" });
    const [upA] = await db.insert(schema.uploads).values({ tenantId: tA.id, refId: "IM-26-401", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });

    // Distinct createdAt so "received" order is deterministic; A1 is left at the
    // default "New" (no history row) to also prove the coalesce-to-New path.
    await db.insert(schema.leads).values([
      { tenantId: tA.id, refId: "LD-26-40101", uploadId: upA.id, dedupeKey: "f103a|1", rawJson: {}, mlsStatus: "kept", matchMethod: "none", sellerFirst: "A", sellerLast: "One", city: "Austin", state: "TX", createdAt: new Date(Date.now() - 30_000) },
      { tenantId: tA.id, refId: "LD-26-40102", uploadId: upA.id, dedupeKey: "f103a|2", rawJson: {}, mlsStatus: "kept", matchMethod: "none", sellerFirst: "B", sellerLast: "Two", city: "Boston", state: "MA", createdAt: new Date(Date.now() - 20_000) },
      { tenantId: tA.id, refId: "LD-26-40103", uploadId: upA.id, dedupeKey: "f103a|3", rawJson: {}, mlsStatus: "kept", matchMethod: "none", sellerFirst: "C", sellerLast: "Three", city: "Chicago", state: "IL", createdAt: new Date(Date.now() - 10_000) },
    ]);

    const scopeAForSeed: ScopeContext = { tenantId: tA.id, role: "admin", userId: id.adminA };
    // A2 -> Contacted, A3 -> Closed; A1 stays New (default, no history row).
    await updateLeadStatus(scopeAForSeed, "LD-26-40102", "Contacted");
    await updateLeadStatus(scopeAForSeed, "LD-26-40103", "Closed");

    // Tenant B — an entirely separate tenant with an overlapping "Closed" status and
    // a city ("Boston") that sorts ahead of/alongside Tenant A's own Boston row, so
    // the tenant predicate (not just the leadId correlation) is what keeps it out.
    const [tB] = await db.insert(schema.tenants).values({ name: "F1-03 Tenant B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantB = tB.id;
    id.adminB = randomUUID();
    await db.insert(schema.users).values({ id: id.adminB, tenantId: tB.id, email: "admin@f103b.test", role: "admin" });
    const [upB] = await db.insert(schema.uploads).values({ tenantId: tB.id, refId: "IM-26-401", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values([
      { tenantId: tB.id, refId: "LD-26-40201", uploadId: upB.id, dedupeKey: "f103b|1", rawJson: {}, mlsStatus: "kept", matchMethod: "none", sellerFirst: "Z", sellerLast: "Other", city: "Boston", state: "MA", createdAt: new Date() },
    ]);
    const scopeBForSeed: ScopeContext = { tenantId: tB.id, role: "admin", userId: id.adminB };
    await updateLeadStatus(scopeBForSeed, "LD-26-40201", "Closed");
  });

  afterAll(async () => {
    await cleanupSlugs([SLUG_A, SLUG_B]);
    await client.end();
  });

  const scopeA = (): ScopeContext => ({ tenantId: id.tenantA, role: "admin", userId: id.adminA });
  const ownRefsA = ["LD-26-40101", "LD-26-40102", "LD-26-40103"];

  it("F1-03: sort=status + statuses=['Closed'] returns only Tenant A's Closed lead, never Tenant B's — behavior-preserving vs the unsorted filter", async () => {
    const filtered = await listLeads(scopeA(), LeadsQuerySchema.parse({ statuses: "Closed" }));
    const sortedFiltered = await listLeads(scopeA(), LeadsQuerySchema.parse({ sort: "status", dir: "asc", statuses: "Closed" }));

    // Behavior-preserving (mirrors F1-01's shape): the scope-aware sort subquery
    // returns the identical scoped rows/count as the unsorted filter.
    expect(sortedFiltered.leads.map((l) => l.refId).sort()).toEqual(filtered.leads.map((l) => l.refId).sort());
    expect(sortedFiltered.total).toBe(filtered.total);

    // Real rows/count, not weakened: exactly Tenant A's one Closed lead.
    expect(filtered.leads.map((l) => l.refId)).toEqual(["LD-26-40103"]);
    expect(filtered.total).toBe(1);
    expect(filtered.leads.every((l) => l.status === "Closed")).toBe(true);
    // The cross-tenant leak this subquery must never produce.
    expect(filtered.leads.map((l) => l.refId)).not.toContain("LD-26-40201");
    expect(sortedFiltered.leads.map((l) => l.refId)).not.toContain("LD-26-40201");
  });

  it("F1-03b: sort=modified returns exactly Tenant A's rows/count, never Tenant B's — proves the latestAt subquery is tenant-scoped", async () => {
    const page = await listLeads(scopeA(), LeadsQuerySchema.parse({ sort: "modified", dir: "desc" }));
    expect(page.leads.map((l) => l.refId).sort()).toEqual([...ownRefsA].sort());
    expect(page.total).toBe(3);
    expect(page.leads.map((l) => l.refId)).not.toContain("LD-26-40201");
  });
});
