import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { partnerDashboardStats, partnerTerritory } from "@/modules/portal/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-portal-dash-wpf3";

suite("WP-F.3: portal dashboard reads (PTL-05/ANA-05, PRN-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.stateRules).where(inArray(schema.stateRules.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "PDash", slug: SLUG }).returning({ id: schema.tenants.id });
    const [me] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-091", name: "Summit", color: "#C79A3E", status: "active" }).returning({ id: schema.partners.id });
    const [other] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-204", name: "Northshore", color: "#5B7A9E", status: "active" }).returning({ id: schema.partners.id });
    await db.insert(schema.stateRules).values([
      { tenantId: t.id, state: "WA", partnerId: me.id },
      { tenantId: t.id, state: "CA", partnerId: other.id }, // NOT mine
    ]);
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-050", filename: "w.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    // Explicit past created_at: the "all" range's upper bound is `now`, so a just-inserted
    // row can fall on the wrong side of a remote-DB/local clock skew. A fixed past date is deterministic.
    const received = new Date("2026-07-01T00:00:00.000Z");
    await db.insert(schema.leads).values([
      { tenantId: t.id, refId: "LD-26-1", uploadId: up.id, dedupeKey: "1|98001", rawJson: {}, partnerId: me.id, state: "WA", mlsStatus: "kept", createdAt: received },
      { tenantId: t.id, refId: "LD-26-2", uploadId: up.id, dedupeKey: "2|90001", rawJson: {}, partnerId: other.id, state: "CA", mlsStatus: "kept", createdAt: received }, // other partner's
    ]);
    scope = { tenantId: t.id, role: "partner", userId: randomUUID(), partnerId: me.id };
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("PTL-05/ANA-05/PRN-08: the portal returns the partner's own mini-stats only", async () => {
    const s = await partnerDashboardStats(scope, "all");
    expect(s.leads).toBe(1); // only LD-26-1 (mine), not the other partner's
    expect(s.untouched).toBe(1);
  });

  it("PRN-08: territory identifies my state (WA) and anonymizes everyone else (CA)", async () => {
    const t = await partnerTerritory(scope);
    const wa = t.states.find((x) => x.code === "WA")!;
    const ca = t.states.find((x) => x.code === "CA")!;
    expect(wa.partnerName).toBe("Summit");
    expect(ca.partnerName).toBeNull(); // never leak Northshore
    expect(ca.color).toBeNull();
    expect(t.ownStateCount).toBe(1);
  });
});
