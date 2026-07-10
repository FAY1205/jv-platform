import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { listLeads } from "@/modules/leads/queries";
import { LeadsQuerySchema } from "@/modules/leads/schema";
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
