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
    const mk = (v: Partial<typeof schema.leads.$inferInsert>) =>
      db.insert(schema.leads).values({ tenantId: t.id, refId: `LD-26-${Math.floor(Math.random() * 100000)}`, uploadId: u.id, dedupeKey: randomUUID(), rawJson: {}, mlsStatus: "kept", matchMethod: "none", ...v });
    await mk({ state: "TX" });
    await mk({ state: "TX" });
    await mk({ state: "FL" });
    await mk({ state: "GA", partnerId: p.id, matchMethod: "zip" }); // routed → excluded
    await mk({ state: "GA", mlsStatus: "removed" });                // removed → excluded
    await mk({ state: "GA", manualPartnerId: p.id });               // manual → excluded (PRN-05/ASN-03)
  });

  afterAll(async () => { await cleanup(); await client.end(); });

  it("ASN-03/F-11: counts only currently-unmatched leads, grouped by state, biggest first", async () => {
    const s = await unmatchedStateStats(scope);
    expect(s.total).toBe(3);
    expect(s.byState).toEqual([{ state: "TX", count: 2 }, { state: "FL", count: 1 }]);
  });
});
