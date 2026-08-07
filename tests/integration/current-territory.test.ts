import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { currentTerritoryQuery } from "@/modules/coverage/current-territory";
import type { ScopeContext } from "@/lib/scope";

// R-62 / audit F-3 (VCF-2.1): the "who owns this partner's ZIPs right now" predicate —
// coverage_zips WHERE effective_to IS NULL (coverage is versioned, DM-06) — was written
// independently at three call sites. This proves the ONE extracted helper returns only the
// OPEN coverage version and the columns deactivation needs to re-version it.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-current-territory-r62";

suite("R-62: currentTerritoryQuery — one currency predicate", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let partnerId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.coverageZips).where(inArray(schema.coverageZips.tenantId, tids));
    await db.delete(schema.stateRules).where(inArray(schema.stateRules.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Current Territory R62", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [p] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" })
      .returning({ id: schema.partners.id });
    partnerId = p.id;
    await db.insert(schema.stateRules).values([
      { tenantId: t.id, state: "SC", partnerId },
      { tenantId: t.id, state: "NC", partnerId },
    ]);
    // Two OPEN zips + a CLOSED (superseded) version of 29407 — currency must exclude the closed one.
    await db.insert(schema.coverageZips).values([
      { tenantId: t.id, zip5: "29407", partnerId, version: 2 },
      { tenantId: t.id, zip5: "28202", partnerId, version: 1 },
      { tenantId: t.id, zip5: "29407", partnerId, version: 1, effectiveTo: new Date("2026-07-01T00:00:00Z") },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("R62-01: returns state rules and only OPEN coverage zips (effectiveTo IS NULL), ordered", async () => {
    const { stateRules, coverageZips } = await currentTerritoryQuery(db, scope, partnerId);
    expect(stateRules.map((s) => s.state)).toEqual(["NC", "SC"]);
    expect(coverageZips.map((z) => z.zip5)).toEqual(["28202", "29407"]);
    expect(coverageZips.every((z) => z.effectiveTo === null)).toBe(true);
  });

  it("R62-02: the current coverage rows carry the columns deactivation needs to re-version them", async () => {
    const { coverageZips } = await currentTerritoryQuery(db, scope, partnerId);
    const z = coverageZips.find((c) => c.zip5 === "29407")!;
    expect(z.version).toBe(2); // the OPEN version, not the closed v1
    expect(z).toHaveProperty("id");
    expect(z).toHaveProperty("county");
    expect(z).toHaveProperty("region");
  });
});
