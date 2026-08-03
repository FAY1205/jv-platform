import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { ensureHousePartner, deactivatePartner, HouseNotAllowedError } from "@/modules/partners/commands";
import { setPartnerCoverage, CoverageConflictError } from "@/modules/coverage/commands";
import { listPartners } from "@/modules/partners/queries";
import { HOUSE_COLOR } from "@/lib/tokens/tokens";
import type { ScopeContext } from "@/lib/scope";

// WP-D (ADR-0037): the tenant's own "house" territory, modeled as an is_house partner so it
// routes and colors maps with no pipeline special-casing. Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-house-wpd";

suite("WP-D: house partner", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let alphaId: string;

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

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "House", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [a] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "PR-001", name: "Alpha", color: "#f4c95d", status: "active" })
      .returning({ id: schema.partners.id });
    alphaId = a.id;
    await db.insert(schema.coverageZips).values({ tenantId: t.id, zip5: "75001", partnerId: alphaId, version: 1 });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("ensureHousePartner creates one house row (is_house, HOUSE ref, reserved color, no email) and is idempotent", async () => {
    const h1 = await ensureHousePartner(scope);
    expect(h1.refId).toBe("HOUSE");
    expect(h1.color).toBe(HOUSE_COLOR);
    expect(h1.name).toBe("My Territory");

    const h2 = await ensureHousePartner(scope);
    expect(h2.id).toBe(h1.id); // no duplicate — returned the existing row

    const rows = await db
      .select()
      .from(schema.partners)
      .where(and(eq(schema.partners.tenantId, scope.tenantId), eq(schema.partners.isHouse, true), isNull(schema.partners.deletedAt)));
    expect(rows).toHaveLength(1);
    expect(rows[0].isHouse).toBe(true);
    expect(rows[0].email).toBeNull();
  });

  it("listPartners returns the house row flagged isHouse alongside real partners", async () => {
    await ensureHousePartner(scope);
    const roster = await listPartners(scope);
    const house = roster.find((p) => p.isHouse);
    expect(house).toBeTruthy();
    expect(house!.refId).toBe("HOUSE");
    expect(roster.filter((p) => !p.isHouse).some((p) => p.refId === "PR-001")).toBe(true);
  });

  it("house coverage conflicts with partners in BOTH directions (no silent overlap)", async () => {
    const house = await ensureHousePartner(scope);

    // House claiming a ZIP Alpha owns → conflict naming Alpha.
    await expect(setPartnerCoverage(scope, house.id, { zips: ["75001"], states: [] })).rejects.toBeInstanceOf(
      CoverageConflictError,
    );

    // House claiming a free ZIP → fine.
    const change = await setPartnerCoverage(scope, house.id, { zips: ["90210"], states: [] });
    expect(change.addedZips).toBe(1);

    // Now a partner claiming the house's ZIP conflicts, naming the house.
    let caught: CoverageConflictError | null = null;
    try {
      await setPartnerCoverage(scope, alphaId, { zips: ["90210"], states: [] });
    } catch (e) {
      caught = e as CoverageConflictError;
    }
    expect(caught).toBeInstanceOf(CoverageConflictError);
    expect(caught!.conflicts[0]).toMatchObject({ kind: "zip", value: "90210", ownerRefId: "HOUSE", ownerName: "My Territory" });
  });

  it("the house cannot be deactivated", async () => {
    const house = await ensureHousePartner(scope);
    await expect(deactivatePartner(scope, house.id)).rejects.toBeInstanceOf(HouseNotAllowedError);
  });
});
