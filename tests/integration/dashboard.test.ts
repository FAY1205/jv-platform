import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { dashboardData } from "@/modules/analytics/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-dashboard-ws2";
const SLUG2 = "test-dashboard-ws2-other";

suite("WS-2: dashboard SQL aggregation (ANA-01/02/03, F-10)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let scopeB: ScopeContext;
  let partnerA: string;
  let partnerB: string;
  let uploadId: string;
  let partnerUserId: string;

  const DAY = 86_400_000;
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * DAY);

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG, SLUG2]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [schema.leadNotes, schema.leadStatusHistory, schema.leads, schema.uploads, schema.users, schema.partners, schema.auditLog]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  async function seedLead(opts: {
    campaign?: string | null; mlsStatus?: "kept" | "removed";
    partnerId?: string | null; manualPartnerId?: string | null; createdAt: Date;
  }): Promise<string> {
    const [l] = await db.insert(schema.leads).values({
      tenantId: scope.tenantId, refId: `LD-26-${Math.floor(Math.random() * 100000)}`,
      uploadId, dedupeKey: randomUUID(), rawJson: {},
      campaign: opts.campaign ?? "Facebook", mlsStatus: opts.mlsStatus ?? "kept",
      partnerId: opts.partnerId ?? null, manualPartnerId: opts.manualPartnerId ?? null,
      matchMethod: opts.partnerId ? "zip" : "none", createdAt: opts.createdAt,
    }).returning({ id: schema.leads.id });
    return l.id;
  }

  const seedStatus = (leadId: string, status: string, at: Date) =>
    db.insert(schema.leadStatusHistory).values({ tenantId: scope.tenantId, leadId, status, createdAt: at });
  const seedPartnerNote = (leadId: string, at: Date) =>
    db.insert(schema.leadNotes).values({ tenantId: scope.tenantId, leadId, authorUserId: partnerUserId, authorRole: "partner", body: "working it", createdAt: at });

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Dash", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [a] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const [b] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "Bravo", color: "#b9c4d6", status: "active" }).returning({ id: schema.partners.id });
    partnerA = a.id; partnerB = b.id;
    const [u] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-001", status: "processed", filename: "x.csv" }).returning({ id: schema.uploads.id });
    uploadId = u.id;
    partnerUserId = randomUUID();
    await db.insert(schema.users).values({ id: partnerUserId, tenantId: t.id, email: "partner@ws2.test", role: "partner", partnerId: partnerA });

    // 1. In-window (30d) distributed lead to A, contacted via status +2h, closed at day 2.
    const l1 = await seedLead({ partnerId: partnerA, createdAt: daysAgo(5) });
    await seedStatus(l1, "Contacted", new Date(daysAgo(5).getTime() + 2 * 3_600_000));
    await seedStatus(l1, "Closed", daysAgo(2));
    // 2. Old (90d) distributed lead to A — outside every window except all-time.
    await seedLead({ partnerId: partnerA, createdAt: daysAgo(90) });
    // 3. In-window unmatched kept lead.
    await seedLead({ partnerId: null, createdAt: daysAgo(4) });
    // 4. In-window removed lead.
    await seedLead({ mlsStatus: "removed", partnerId: partnerA, createdAt: daysAgo(4) });
    // 5. Re-routed lead: pipeline A, manual B → effective owner is B, no action.
    await seedLead({ partnerId: partnerA, manualPartnerId: partnerB, createdAt: daysAgo(6) });
    // 6. In-window distributed lead to A whose ONLY action is a partner note (no status
    //    change) — proves a note counts as a first action (ANA-03).
    const lNote = await seedLead({ partnerId: partnerA, createdAt: daysAgo(3) });
    await seedPartnerNote(lNote, new Date(daysAgo(3).getTime() + 1 * 3_600_000));

    // Second tenant — isolation guard for the new raw-SQL path (PRN-08 / TST-01).
    const [t2] = await db.insert(schema.tenants).values({ name: "Other", slug: SLUG2 }).returning({ id: schema.tenants.id });
    scopeB = { tenantId: t2.id, role: "admin", userId: randomUUID() };
    const [pb] = await db.insert(schema.partners).values({ tenantId: t2.id, refId: "JV-001", name: "Other P", color: "#cccccc", status: "active" }).returning({ id: schema.partners.id });
    const [ub] = await db.insert(schema.uploads).values({ tenantId: t2.id, refId: "IM-26-001", status: "processed", filename: "y.csv" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({ tenantId: t2.id, refId: "LD-26-1", uploadId: ub.id, dedupeKey: randomUUID(), rawJson: {}, campaign: "Facebook", mlsStatus: "kept", partnerId: pb.id, matchMethod: "zip", createdAt: daysAgo(1) });
  });

  afterAll(async () => { await cleanup(); await client.end(); });

  it("F-10: 30d stats bound by range — old lead excluded, in-window counted", async () => {
    const d = await dashboardData(scope, "30d");
    // Leads in (30d): l1, unmatched, removed, re-routed, note-lead = 5 (90d lead excluded).
    expect(d.stats.leadsIn.value).toBe(5);
    // Distributed = kept + effective owner present: l1 + re-routed + note-lead = 3.
    expect(d.stats.distributed.value).toBe(3);
    expect(d.stats.unmatched.value).toBe(1);
    expect(d.stats.removed.value).toBe(1);
    expect(d.stats.closed.value).toBe(1);
  });

  it("F-01/ASN-04: Distributed uses the effective owner — re-routed lead counts for the manual partner", async () => {
    const d = await dashboardData(scope, "all");
    const bravo = d.partners.find((p) => p.partnerId === partnerB);
    const alpha = d.partners.find((p) => p.partnerId === partnerA);
    expect(bravo?.given).toBe(1); // the re-routed lead only
    // Alpha given (all-time, kept, effective owner A): l1 + old + note-lead = 3.
    expect(alpha?.given).toBe(3);
  });

  it("ANA-03: a partner note counts as a first action; untouched excludes note-only leads", async () => {
    const d = await dashboardData(scope, "30d");
    const alpha = d.partners.find((p) => p.partnerId === partnerA)!;
    // Contacted = l1 (status change) + note-lead (partner note). If notes were ignored
    // this would be 1 — so 2 proves the note path.
    expect(alpha.contacted).toBe(2);
    expect(alpha.untouched).toBe(0);
    // Avg contact = mean of (2h via status, 1h via note) = 1.5h.
    expect(alpha.avgContactHours).toBeGreaterThan(0.5);
    expect(alpha.avgContactHours).toBeLessThan(2.5);
    // Bravo's re-routed lead has no action → untouched, no avg.
    const bravo = d.partners.find((p) => p.partnerId === partnerB)!;
    expect(bravo.untouched).toBe(1);
    expect(bravo.avgContactHours).toBeNull();
  });

  it("ANA-01: trend zero-fills the FULL 30d window with daily buckets", async () => {
    const d = await dashboardData(scope, "30d");
    expect(d.range.bucket).toBe("day");
    // Full 30-day daily window → ~31 buckets, most of them empty (F-2 full-window zero-fill).
    expect(d.trend.length).toBeGreaterThanOrEqual(28);
    expect(d.trend.length).toBeLessThanOrEqual(32);
    expect(d.trend.reduce((s, b) => s + b.leadsIn, 0)).toBe(5);
    expect(d.trend.some((b) => b.leadsIn === 0)).toBe(true); // an empty day is present
  });

  it("ANA-02: source rows carry imported/removed/removalRate", async () => {
    const d = await dashboardData(scope, "30d");
    const fb = d.sources.find((s) => s.campaign === "Facebook")!;
    expect(fb.imported).toBe(5);
    expect(fb.removed).toBe(1);
    expect(fb.removalRate).toBeCloseTo(0.2, 5);
  });

  it("PRN-08/TST-01: dashboardData never crosses tenants", async () => {
    const a = await dashboardData(scope, "all");
    // Tenant A owns exactly six leads; tenant B's lead must not leak in.
    expect(a.stats.leadsIn.value).toBe(6);
    expect(a.partners.some((p) => p.partnerId === scopeB.tenantId)).toBe(false);
    // Tenant B sees only its single lead.
    const b = await dashboardData(scopeB, "all");
    expect(b.stats.leadsIn.value).toBe(1);
  });
});
