import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { setPartnerCoverage } from "@/modules/coverage/commands";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-coverage-wp031a";

suite("WP-031a: per-partner coverage entry (CVG-01, DM-06)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let alphaId: string;
  let bravoId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    for (const tbl of [schema.coverageZips, schema.stateRules, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  async function currentZipsOf(partnerId: string): Promise<string[]> {
    const rows = await db
      .select({ zip5: schema.coverageZips.zip5 })
      .from(schema.coverageZips)
      .where(and(eq(schema.coverageZips.tenantId, scope.tenantId), eq(schema.coverageZips.partnerId, partnerId), isNull(schema.coverageZips.effectiveTo)));
    return rows.map((r) => r.zip5).sort();
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Cov", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [a] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const [b] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "Bravo", color: "#b9c4d6", status: "active" }).returning({ id: schema.partners.id });
    alphaId = a.id;
    bravoId = b.id;
    // Alpha starts with 75001 + state TX.
    await db.insert(schema.coverageZips).values({ tenantId: t.id, zip5: "75001", partnerId: alphaId, version: 1 });
    await db.insert(schema.stateRules).values({ tenantId: t.id, state: "TX", partnerId: alphaId });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("CVG-01: adds new ZIPs and keeps existing ones", async () => {
    const change = await setPartnerCoverage(scope, alphaId, { zips: ["75001", "75002"], states: ["TX"] });
    expect(change.addedZips).toBe(1);
    expect(change.removedZips).toBe(0);
    expect(await currentZipsOf(alphaId)).toEqual(["75001", "75002"]);
  });

  it("CVG-01/DM-06: assigning a ZIP owned by another partner reassigns it (old row closed, new version)", async () => {
    const change = await setPartnerCoverage(scope, bravoId, { zips: ["75001"], states: [] });
    expect(change.reassignedZips).toBe(1);

    // Exactly one CURRENT 75001, now Bravo's, at a bumped version; Alpha's row is closed.
    const current = await db.select().from(schema.coverageZips).where(and(eq(schema.coverageZips.tenantId, scope.tenantId), eq(schema.coverageZips.zip5, "75001"), isNull(schema.coverageZips.effectiveTo)));
    expect(current).toHaveLength(1);
    expect(current[0].partnerId).toBe(bravoId);
    expect(current[0].version).toBe(2);
    expect(await currentZipsOf(alphaId)).toEqual(["75002"]); // Alpha keeps its other ZIP
  });

  it("CVG-01: an empty entry removes this partner's remaining ZIPs + states", async () => {
    const change = await setPartnerCoverage(scope, alphaId, { zips: [], states: [] });
    expect(change.removedZips).toBe(1); // 75002 dropped
    expect(await currentZipsOf(alphaId)).toEqual([]);
    const tx = await db.select().from(schema.stateRules).where(and(eq(schema.stateRules.tenantId, scope.tenantId), eq(schema.stateRules.state, "TX")));
    expect(tx).toHaveLength(0); // TX state rule removed
  });
});
