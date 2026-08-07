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
    // 20 min before real now, so the leads are past the distribution hold window (released to the
    // partner) regardless of the machine clock — the gate compares against `new Date()`.
    const received = new Date(Date.now() - 20 * 60 * 1000);
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

suite("WP-PW-2b: portal dashboard KPI deltas (ANA-02, PRN-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;

  const DAY = 86_400_000;
  const SLUG_DELTA = "test-portal-dash-wppw2b";
  const SLUG_DELTA_OTHER = "test-portal-dash-wppw2b-other";

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG_DELTA, SLUG_DELTA_OTHER]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  let otherPartnerId: string;
  let otherTenantPartnerId: string;

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();

    const now = Date.now();
    const ago = (ms: number) => new Date(now - ms);
    // Past the 10-min distribution hold in all cases below.

    const [t] = await db.insert(schema.tenants).values({ name: "PDashDelta", slug: SLUG_DELTA }).returning({ id: schema.tenants.id });
    const [me] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-301", name: "Cascade", color: "#3E8ED0", status: "active" }).returning({ id: schema.partners.id });
    // A real partner user so status changes carry an actor (production always stamps changedByUserId;
    // partnerPerformanceDetail attributes a touch only to the measured partner's own org — R-22).
    const meUserId = randomUUID();
    await db.insert(schema.users).values({ id: meUserId, tenantId: t.id, email: "me@pdash.test", role: "partner", partnerId: me.id });
    const [other] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-302", name: "Foothill", color: "#8E5B3E", status: "active" }).returning({ id: schema.partners.id });
    otherPartnerId = other.id;
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-060", filename: "d.xlsx", status: "processed" }).returning({ id: schema.uploads.id });

    // Mine — current 30d window: 2 given, 1 touched (→1 untouched), 1 closed.
    const [curTouched] = await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-DELTA-1", uploadId: up.id, dedupeKey: "d1", rawJson: {}, partnerId: me.id, mlsStatus: "kept", createdAt: ago(5 * DAY) }).returning({ id: schema.leads.id });
    await db.insert(schema.leadStatusHistory).values({ tenantId: t.id, leadId: curTouched.id, status: "Contacted", changedByUserId: meUserId, createdAt: ago(5 * DAY - 3_600_000) });
    await db.insert(schema.leadStatusHistory).values({ tenantId: t.id, leadId: curTouched.id, status: "Closed", changedByUserId: meUserId, createdAt: ago(4 * DAY) });
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-DELTA-2", uploadId: up.id, dedupeKey: "d2", rawJson: {}, partnerId: me.id, mlsStatus: "kept", createdAt: ago(3 * DAY) }); // untouched

    // Mine — prior 30d window (30-60d ago): 1 given, 0 touched (→1 untouched), 0 closed.
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-DELTA-3", uploadId: up.id, dedupeKey: "d3", rawJson: {}, partnerId: me.id, mlsStatus: "kept", createdAt: ago(40 * DAY) }); // prior, untouched

    // Other partner (same tenant) — should not affect my deltas: both windows.
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-DELTA-4", uploadId: up.id, dedupeKey: "d4", rawJson: {}, partnerId: other.id, mlsStatus: "kept", createdAt: ago(2 * DAY) });
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-DELTA-5", uploadId: up.id, dedupeKey: "d5", rawJson: {}, partnerId: other.id, mlsStatus: "kept", createdAt: ago(45 * DAY) });

    // A second tenant entirely — should not affect my deltas either.
    const [t2] = await db.insert(schema.tenants).values({ name: "PDashDeltaOther", slug: SLUG_DELTA_OTHER }).returning({ id: schema.tenants.id });
    const [otherTenantPartner] = await db.insert(schema.partners).values({ tenantId: t2.id, refId: "JV-301", name: "Cascade2", color: "#3E8ED0", status: "active" }).returning({ id: schema.partners.id });
    otherTenantPartnerId = otherTenantPartner.id;
    const [up2] = await db.insert(schema.uploads).values({ tenantId: t2.id, refId: "IM-26-061", filename: "e.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({ tenantId: t2.id, refId: "LD-DELTA-6", uploadId: up2.id, dedupeKey: "d6", rawJson: {}, partnerId: otherTenantPartner.id, mlsStatus: "kept", createdAt: ago(6 * DAY) });
    await db.insert(schema.leads).values({ tenantId: t2.id, refId: "LD-DELTA-7", uploadId: up2.id, dedupeKey: "d7", rawJson: {}, partnerId: otherTenantPartner.id, mlsStatus: "kept", createdAt: ago(50 * DAY) });

    scope = { tenantId: t.id, role: "partner", userId: meUserId, partnerId: me.id };
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("PW2B-04: leadsDelta/contactedDelta/closedDelta/untouchedDelta = current − prior for my own leads", async () => {
    const s = await partnerDashboardStats(scope, "30d");
    // current: given=2, contacted=1, closed=1, untouched=1; prior: given=1, contacted=0, closed=0, untouched=1
    expect(s.leads).toBe(2);
    expect(s.contacted).toBe(1);
    expect(s.closed).toBe(1);
    expect(s.untouched).toBe(1);
    expect(s.leadsDelta).toBe(1); // 2 - 1
    expect(s.contactedDelta).toBe(1); // 1 - 0
    expect(s.closedDelta).toBe(1); // 1 - 0
    expect(s.untouchedDelta).toBe(0); // 1 - 1
  });

  it("PW2B-05: range \"all\" has no prior window ⇒ all four deltas are null", async () => {
    const s = await partnerDashboardStats(scope, "all");
    expect(s.leadsDelta).toBeNull();
    expect(s.untouchedDelta).toBeNull();
    expect(s.contactedDelta).toBeNull();
    expect(s.closedDelta).toBeNull();
  });

  it("PW2B-06 (PRN-08): another partner's / another tenant's prior-window leads do not affect my deltas", async () => {
    const otherScope: ScopeContext = { tenantId: scope.tenantId, role: "partner", userId: randomUUID(), partnerId: otherPartnerId };
    const otherStats = await partnerDashboardStats(otherScope, "30d");
    // other partner: current given=1 (LD-DELTA-4), prior given=1 (LD-DELTA-5) → delta 0, isolated from mine.
    expect(otherStats.leadsDelta).toBe(0);

    const mine = await partnerDashboardStats(scope, "30d");
    // Raw-count hardening (audit-tenancy F-1): with the foreign partner's + foreign tenant's
    // current-window rows (LD-DELTA-4, LD-DELTA-6) resident, my current count is EXACTLY my own
    // two leads — a delta-only assertion could mask a symmetric leak, this pins it. Combined with
    // leadsDelta===1 this forces my prior=1 (LD-DELTA-3), so a prior-window leak is caught too.
    expect(mine.leads).toBe(2);
    expect(mine.leadsDelta).toBe(1); // unaffected by the other partner's or other tenant's leads

    const otherTenantScope: ScopeContext = { tenantId: (await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG_DELTA_OTHER)))[0].id, role: "partner", userId: randomUUID(), partnerId: otherTenantPartnerId };
    const otherTenantStats = await partnerDashboardStats(otherTenantScope, "30d");
    expect(otherTenantStats.leadsDelta).toBe(0); // its own current(1) - prior(1), isolated
  });
});
