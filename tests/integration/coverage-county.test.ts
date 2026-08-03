import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { coverageMapData } from "@/modules/coverage/queries";
import type { ScopeContext } from "@/lib/scope";

// WP-E (owner note #6): /api/coverage now resolves ZIP coverage to county-level ownership so the
// maps color the actual county a partner covers. 75001 is in the fixture crosswalk → Dallas County
// (FIPS 48113). Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-coverage-county-wpe";

suite("WP-E: coverageMapData county resolution", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let alphaId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [schema.coverageZips, schema.stateRules, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "CovCounty", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [a] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "PR-001", name: "Alpha", color: "#f4c95d", status: "active" })
      .returning({ id: schema.partners.id });
    alphaId = a.id;
    // 75001 → Dallas County (48113) in the fixture crosswalk; 00000 is unknown (dropped).
    await db.insert(schema.coverageZips).values([
      { tenantId: t.id, zip5: "75001", partnerId: alphaId, version: 1 },
      { tenantId: t.id, zip5: "00000", partnerId: alphaId, version: 1 },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("resolves a partner's ZIP coverage to the county it belongs to", async () => {
    const res = await coverageMapData(scope);
    const dallas = res.counties.find((c) => c.fips === "48113");
    expect(dallas).toBeTruthy();
    expect(dallas!.partnerId).toBe(alphaId);
    expect(dallas!.refId).toBe("PR-001");
    // The unmapped 00000 ZIP produced no county row.
    expect(res.counties).toHaveLength(1);
    // Both ZIP rows still count toward the ZIP-coverage total.
    expect(res.zipCoverageCount).toBe(2);
  });
});
