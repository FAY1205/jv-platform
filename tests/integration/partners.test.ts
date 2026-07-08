import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import {
  createPartner,
  updatePartner,
  deactivatePartner,
  ReassignmentRequiredError,
} from "@/modules/partners/commands";
import { listPartners, territoryOf } from "@/modules/partners/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-partners-wp030";

suite("WP-030: partners CRUD + deactivation → reassignment (ADM-03, PRN-05)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let alphaId: string;
  let bravoId: string;
  let leadId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.coverageZips).where(inArray(schema.coverageZips.tenantId, tids));
    await db.delete(schema.stateRules).where(inArray(schema.stateRules.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Partners WP030", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };

    const [a] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const [b] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "Bravo", color: "#b9c4d6", status: "active" }).returning({ id: schema.partners.id });
    alphaId = a.id;
    bravoId = b.id;

    // Alpha owns TX (state) + 75001 (zip). A historical lead is assigned to Alpha.
    await db.insert(schema.stateRules).values({ tenantId: t.id, state: "TX", partnerId: alphaId });
    await db.insert(schema.coverageZips).values({ tenantId: t.id, zip5: "75001", partnerId: alphaId, version: 1 });
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "UP-2026-001", filename: "w.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [ld] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-2026-00001", uploadId: up.id, dedupeKey: "1 tx st|75001", rawJson: {}, partnerId: alphaId, matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    leadId = ld.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("ADM-03: create allocates the next JV-### + an unused locked color, status not_invited", async () => {
    // The command trusts route-validated input (Zod trims/validates at the boundary,
    // covered by partners-schema.test.ts); here we assert allocation + persistence.
    const created = await createPartner(scope, { name: "Charlie Capital", email: "charlie@example.com" });
    expect(created.refId).toBe("JV-003");
    expect(["#f4c95d", "#b9c4d6"]).not.toContain(created.color); // not Alpha's/Bravo's

    const roster = await listPartners(scope);
    const charlie = roster.find((p) => p.refId === "JV-003")!;
    expect(charlie.name).toBe("Charlie Capital");
    expect(charlie.status).toBe("not_invited");

    const audits = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, scope.tenantId), eq(schema.auditLog.action, "partner.created")));
    expect(audits.some((a) => a.entityRef === "JV-003")).toBe(true);
  });

  it("ADM-03: update changes contact details but never the locked color", async () => {
    const roster = await listPartners(scope);
    const charlie = roster.find((p) => p.refId === "JV-003")!;
    await updatePartner(scope, charlie.id, { dealTerms: "60/40", phone: "555-0100" });

    const after = (await listPartners(scope)).find((p) => p.refId === "JV-003")!;
    expect(after.dealTerms).toBe("60/40");
    expect(after.phone).toBe("555-0100");
    expect(after.color).toBe(charlie.color); // unchanged
  });

  it("PRN-05: deactivate → reassign repoints rules + versions coverage; the historical lead is untouched", async () => {
    const res = await deactivatePartner(scope, alphaId, { mode: "reassign", toPartnerId: bravoId });
    expect(res.movedStates).toBe(1);
    expect(res.movedZips).toBe(1);
    expect(res.toPartnerRef).toBe("JV-002");

    // State rule TX now belongs to Bravo.
    const tx = await db.select().from(schema.stateRules).where(and(eq(schema.stateRules.tenantId, scope.tenantId), eq(schema.stateRules.state, "TX")));
    expect(tx[0].partnerId).toBe(bravoId);

    // Coverage: exactly one CURRENT 75001 row, owned by Bravo, version 2.
    const current = await db.select().from(schema.coverageZips).where(and(eq(schema.coverageZips.tenantId, scope.tenantId), eq(schema.coverageZips.zip5, "75001"), isNull(schema.coverageZips.effectiveTo)));
    expect(current).toHaveLength(1);
    expect(current[0].partnerId).toBe(bravoId);
    expect(current[0].version).toBe(2);

    // The old Alpha coverage row is closed, not deleted (versioned history, DM-06).
    const closed = await db.select().from(schema.coverageZips).where(and(eq(schema.coverageZips.tenantId, scope.tenantId), eq(schema.coverageZips.partnerId, alphaId)));
    expect(closed[0].effectiveTo).not.toBeNull();

    // Alpha is deactivated.
    const [alpha] = await db.select().from(schema.partners).where(eq(schema.partners.id, alphaId));
    expect(alpha.status).toBe("revoked");
    expect(alpha.deletedAt).not.toBeNull();

    // PRN-05: the already-assigned lead STILL points at Alpha — never rewritten.
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    expect(lead.partnerId).toBe(alphaId);

    // Alpha drops off the active roster; Bravo now owns the territory.
    expect((await listPartners(scope)).some((p) => p.id === alphaId)).toBe(false);
    const bravoTerritory = await territoryOf(scope, bravoId);
    expect(bravoTerritory.states).toContain("TX");
    expect(bravoTerritory.zips).toContain("75001");
  });

  it("ADM-03: deactivate → Unmatched drops the rules with no successor", async () => {
    const [echo] = await db.insert(schema.partners).values({ tenantId: scope.tenantId, refId: "JV-050", name: "Echo", color: "#7fd1c8", status: "active" }).returning({ id: schema.partners.id });
    await db.insert(schema.stateRules).values({ tenantId: scope.tenantId, state: "AZ", partnerId: echo.id });
    await db.insert(schema.coverageZips).values({ tenantId: scope.tenantId, zip5: "85001", partnerId: echo.id, version: 1 });

    const res = await deactivatePartner(scope, echo.id, { mode: "unmatched" });
    expect(res.mode).toBe("unmatched");

    const az = await db.select().from(schema.stateRules).where(and(eq(schema.stateRules.tenantId, scope.tenantId), eq(schema.stateRules.state, "AZ")));
    expect(az).toHaveLength(0); // routed to Unmatched
    const current = await db.select().from(schema.coverageZips).where(and(eq(schema.coverageZips.tenantId, scope.tenantId), eq(schema.coverageZips.zip5, "85001"), isNull(schema.coverageZips.effectiveTo)));
    expect(current).toHaveLength(0); // no successor
  });

  it("ADM-03: deactivating a partner with territory but no decision demands one", async () => {
    const [foxtrot] = await db.insert(schema.partners).values({ tenantId: scope.tenantId, refId: "JV-051", name: "Foxtrot", color: "#9cc69b", status: "active" }).returning({ id: schema.partners.id });
    await db.insert(schema.stateRules).values({ tenantId: scope.tenantId, state: "WA", partnerId: foxtrot.id });

    await expect(deactivatePartner(scope, foxtrot.id)).rejects.toBeInstanceOf(ReassignmentRequiredError);

    // Still active — nothing was changed.
    const [f] = await db.select().from(schema.partners).where(eq(schema.partners.id, foxtrot.id));
    expect(f.status).toBe("active");
    expect(f.deletedAt).toBeNull();
  });
});
