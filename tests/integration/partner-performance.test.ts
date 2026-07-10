import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { partnerPerformanceDetail } from "@/modules/analytics/partner-performance";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-partner-perf-ws5";
const SLUG2 = "test-partner-perf-ws5-other";

suite("WS-5: partnerPerformanceDetail (ANA-02/03, PRN-08/13)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let partnerA: string;
  let partnerB: string;
  let uploadId: string;
  let partnerUserId: string;
  let scopeB: ScopeContext;
  let partnerOther: string;

  const DAY = 86_400_000;
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * DAY);

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG, SLUG2]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [schema.leadNotes, schema.leadStatusHistory, schema.leads, schema.uploads, schema.users, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  const mkLead = (v: Partial<typeof schema.leads.$inferInsert>) =>
    db.insert(schema.leads).values({ tenantId: scope.tenantId, refId: `LD-26-${Math.floor(Math.random() * 100000)}`, uploadId, dedupeKey: randomUUID(), rawJson: {}, mlsStatus: "kept", matchMethod: "zip", ...v }).returning({ id: schema.leads.id });

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "PP", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [a] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const [b] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "Bravo", color: "#b9c4d6", status: "active" }).returning({ id: schema.partners.id });
    partnerA = a.id; partnerB = b.id;
    const [u] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-001", status: "processed", filename: "x.csv" }).returning({ id: schema.uploads.id });
    uploadId = u.id;
    partnerUserId = randomUUID();
    await db.insert(schema.users).values({ id: partnerUserId, tenantId: t.id, email: "p@pp.test", role: "partner", partnerId: partnerA });

    // l1: A, contacted via status change.
    const [l1] = await mkLead({ partnerId: partnerA, createdAt: daysAgo(5) });
    await db.insert(schema.leadStatusHistory).values({ tenantId: t.id, leadId: l1.id, status: "Contacted", createdAt: new Date(daysAgo(5).getTime() + 2 * 3_600_000) });
    // l2: A, contacted via a PARTNER note only (PRN-13).
    const [l2] = await mkLead({ partnerId: partnerA, createdAt: daysAgo(4) });
    await db.insert(schema.leadNotes).values({ tenantId: t.id, leadId: l2.id, authorUserId: partnerUserId, authorRole: "partner", body: "called", createdAt: new Date(daysAgo(4).getTime() + 3_600_000) });
    // l3: re-routed — pipeline B, manual A → effective owner A, no action.
    await mkLead({ partnerId: partnerB, manualPartnerId: partnerA, createdAt: daysAgo(3) });
    // l4: owned by B only — excluded from A.
    await mkLead({ partnerId: partnerB, createdAt: daysAgo(2) });

    // Second tenant — cross-tenant isolation guard for the raw-SQL path (PRN-08).
    const [t2] = await db.insert(schema.tenants).values({ name: "Other", slug: SLUG2 }).returning({ id: schema.tenants.id });
    scopeB = { tenantId: t2.id, role: "admin", userId: randomUUID() };
    const [po] = await db.insert(schema.partners).values({ tenantId: t2.id, refId: "JV-001", name: "Other P", color: "#cccccc", status: "active" }).returning({ id: schema.partners.id });
    partnerOther = po.id;
    const [uo] = await db.insert(schema.uploads).values({ tenantId: t2.id, refId: "IM-26-001", status: "processed", filename: "y.csv" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({ tenantId: t2.id, refId: "LD-26-1", uploadId: uo.id, dedupeKey: randomUUID(), rawJson: {}, mlsStatus: "kept", matchMethod: "zip", partnerId: partnerOther, createdAt: daysAgo(1) });
  });

  afterAll(async () => { await cleanup(); await client.end(); });

  it("ANA-02/PRN-08: counts only this partner's effective-owned kept leads", async () => {
    const r = await partnerPerformanceDetail(scope, partnerA, "all");
    expect(r.stats.given).toBe(3); // l1 + l2 + re-routed l3
  });

  it("ANA-03/PRN-13: a partner note counts as a first action (contacted)", async () => {
    const r = await partnerPerformanceDetail(scope, partnerA, "all");
    expect(r.stats.contacted).toBe(2); // l1 (status) + l2 (note); l3 untouched
    expect(r.stats.avgContactHours).toBeGreaterThan(0);
  });

  it("ANA-02: the other partner sees only its own lead", async () => {
    const r = await partnerPerformanceDetail(scope, partnerB, "all");
    expect(r.stats.given).toBe(1); // l4 only (l3's effective owner is A)
  });

  it("PRN-08: never crosses tenants — tenant A's scope can't see tenant B's partner's leads", async () => {
    const leaked = await partnerPerformanceDetail(scope, partnerOther, "all");
    expect(leaked.stats.given).toBe(0);
    const own = await partnerPerformanceDetail(scopeB, partnerOther, "all");
    expect(own.stats.given).toBe(1);
  });
});
