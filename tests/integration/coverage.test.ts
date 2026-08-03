import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { setPartnerCoverage, CoverageConflictError } from "@/modules/coverage/commands";
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

  it("WP-C: claiming a ZIP owned by another partner is a hard conflict — nothing is reassigned", async () => {
    // Bravo tries to take 75001 (Alpha's). Instead of silently stealing it, the save is rejected
    // with a conflict that names Alpha, and Alpha keeps the ZIP untouched.
    let caught: CoverageConflictError | null = null;
    try {
      await setPartnerCoverage(scope, bravoId, { zips: ["75001"], states: [] });
    } catch (e) {
      caught = e as CoverageConflictError;
    }
    expect(caught).toBeInstanceOf(CoverageConflictError);
    expect(caught!.conflicts).toHaveLength(1);
    expect(caught!.conflicts[0]).toMatchObject({ kind: "zip", value: "75001", ownerRefId: "JV-001", ownerName: "Alpha" });

    // Nothing moved: Alpha still owns 75001 (+75002 from the prior test); Bravo owns nothing.
    expect(await currentZipsOf(alphaId)).toEqual(["75001", "75002"]);
    expect(await currentZipsOf(bravoId)).toEqual([]);
  });

  it("WP-C: claiming a STATE owned by another partner is a hard conflict too", async () => {
    let caught: CoverageConflictError | null = null;
    try {
      await setPartnerCoverage(scope, bravoId, { zips: [], states: ["TX"] });
    } catch (e) {
      caught = e as CoverageConflictError;
    }
    expect(caught).toBeInstanceOf(CoverageConflictError);
    expect(caught!.conflicts[0]).toMatchObject({ kind: "state", value: "TX", ownerRefId: "JV-001", ownerName: "Alpha" });

    // TX still Alpha's.
    const tx = await db.select().from(schema.stateRules).where(and(eq(schema.stateRules.tenantId, scope.tenantId), eq(schema.stateRules.state, "TX")));
    expect(tx).toHaveLength(1);
    expect(tx[0].partnerId).toBe(alphaId);
  });

  it("CVG-01: an empty entry removes this partner's remaining ZIPs + states", async () => {
    const change = await setPartnerCoverage(scope, alphaId, { zips: [], states: [] });
    expect(change.removedZips).toBe(2); // 75001 + 75002 dropped (nothing was reassigned away)
    expect(await currentZipsOf(alphaId)).toEqual([]);
    const tx = await db.select().from(schema.stateRules).where(and(eq(schema.stateRules.tenantId, scope.tenantId), eq(schema.stateRules.state, "TX")));
    expect(tx).toHaveLength(0); // TX state rule removed
  });
});
