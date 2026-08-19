import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { leadNavCounts, listLeads } from "@/modules/leads/queries";
import { LeadsQuerySchema, DEFAULT_STATUS_FILTERS } from "@/modules/leads/schema";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG_A = "test-leads-count-a-wpb";
const SLUG_B = "test-leads-count-b-wpb";

// WP-B: the Leads nav badge count. PRN-08 — it must count only the scope's own leads;
// F-2 — it must exclude soft-deleted rows, matching the /leads list total.
// C-41d: the two count queries merged into one round trip (leadNavCounts → { total, unmatched }),
// so the unmatched half is asserted here too — the FILTER must narrow, never widen.
suite("WP-B: leadNavCounts (PRN-08 isolation + soft-delete exclusion)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scopeA: ScopeContext;
  let scopeB: ScopeContext;

  async function cleanup() {
    const t = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [ta] = await db.insert(schema.tenants).values({ name: "A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    const [tb] = await db.insert(schema.tenants).values({ name: "B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    scopeA = { tenantId: ta.id, role: "admin", userId: randomUUID() };
    scopeB = { tenantId: tb.id, role: "admin", userId: randomUUID() };
    const [ua] = await db.insert(schema.uploads).values({ tenantId: ta.id, refId: "IM-26-101", status: "processed", filename: "a.csv" }).returning({ id: schema.uploads.id });
    const [ub] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "IM-26-201", status: "processed", filename: "b.csv" }).returning({ id: schema.uploads.id });
    const mk = (tenantId: string, uploadId: string, v?: Partial<typeof schema.leads.$inferInsert>) =>
      db.insert(schema.leads).values({ tenantId, refId: `LD-26-${Math.floor(Math.random() * 100000)}`, uploadId, dedupeKey: randomUUID(), rawJson: {}, mlsStatus: "kept", matchMethod: "none", ...v });
    await mk(ta.id, ua.id);
    await mk(ta.id, ua.id);
    // MLS-removed → counted in the total, but NOT part of the unmatched backlog (C-41d).
    await mk(ta.id, ua.id, { mlsStatus: "removed" });
    await mk(ta.id, ua.id, { deletedAt: new Date() }); // soft-deleted → excluded (F-2)
    // N3C-01/Q3: a second MLS-removed row in the OTHER tenant, so a dropped tenant predicate
    // on the new `active` filter would show up as a wrong number here rather than passing.
    await mk(tb.id, ub.id, { mlsStatus: "removed" });
    await mk(tb.id, ub.id); // other tenant → must not leak into A's count (PRN-08)
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("PRN-08: counts only the scope's own, non-deleted leads", async () => {
    expect((await leadNavCounts(scopeA)).total).toBe(3);
  });

  it("C-41d: the unmatched FILTER narrows the same scan — backlog only, never wider than the total", async () => {
    const counts = await leadNavCounts(scopeA);
    // 3 non-deleted in A; the MLS-removed one is not backlog.
    expect(counts).toEqual({ total: 3, active: 2, unmatched: 2 });
    expect(counts.unmatched).toBeLessThanOrEqual(counts.total);
  });

  it("N3C-01/Q3: active count excludes Removed MLS and composes tenant scope", async () => {
    // Tenant A holds 3 non-deleted leads, ONE of which is MLS-removed — so the Leads badge
    // must read 2, the set the default /leads view actually opens with, not 3.
    const a = await leadNavCounts(scopeA);
    expect(a.active).toBe(2);
    expect(a.total).toBe(3);
    // A strict narrowing of the same scan, exactly like `unmatched` — never wider.
    expect(a.active).toBeLessThanOrEqual(a.total);

    // PRN-08 cross-tenant leg: B's own numbers are B's alone. B holds 2 leads, one removed —
    // if the new FILTER lost the outer tenant predicate, B would read A's rows too.
    const b = await leadNavCounts(scopeB);
    expect(b).toEqual({ total: 2, active: 1, unmatched: 1 });
  });

  // audit-tenancy F-2: the outer predicate is the `leadWhere` BUILDER, not a hand-rolled
  // tenant equality. For the admin stream the two are identical, so this leg pins the
  // observable half — the boundary is a builder call, and it still isolates.
  it("N3C-01/Q3 (audit-tenancy F-2): the counts compose lib/scope's leadWhere, and stay isolated", async () => {
    const [a, b] = await Promise.all([leadNavCounts(scopeA), leadNavCounts(scopeB)]);
    // Neither tenant's numbers include the other's rows: the union would be 5 total / 3 active.
    expect(a.total + b.total).toBe(5);
    expect(a).not.toEqual(b);
    expect(a.total).toBe(3);
    expect(b.total).toBe(2);
    // Every count is a strict narrowing of that scope's own total — never the union.
    for (const c of [a, b]) {
      expect(c.active).toBeLessThanOrEqual(c.total);
      expect(c.unmatched).toBeLessThanOrEqual(c.total);
    }
  });

  // audit-tenancy F-3: "active" has two expressible definitions. They agree while every
  // status is one of the seeded six and diverge the moment SEAM-06 (tenant-editable statuses,
  // `lead_status_history.status` is TEXT) puts a lead in a status the default filter set has
  // never heard of. This pins BOTH halves so the choice can't be silently reversed.
  it("N3C-01/Q3 (audit-tenancy F-3): 'active' is the not-removed COLUMN, and stays right when a status goes off-list", async () => {
    // The query the /leads page actually opens with: schema defaults + the UI's default status
    // selection (LeadsQuerySchema's own default is "no status filter"). 50 is the largest
    // allowed page size and comfortably exceeds this fixture, so `total` is the whole set.
    const defaultQuery = { ...LeadsQuerySchema.parse({ pageSize: "50" }), statuses: [...DEFAULT_STATUS_FILTERS] };

    // (1) While every status is seeded, the two definitions agree — this is the equivalence
    //     the "N active leads · M total" header leans on.
    const before = await leadNavCounts(scopeA);
    expect((await listLeads(scopeA, defaultQuery)).total).toBe(before.active);

    // (2) Put one of A's kept leads into a tenant-custom status.
    const [target] = await db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, scopeA.tenantId), eq(schema.leads.mlsStatus, "kept"), isNull(schema.leads.deletedAt)))
      .limit(1);
    await db.insert(schema.leadStatusHistory).values({
      tenantId: scopeA.tenantId,
      leadId: target.id,
      status: "Escalated", // not in LEAD_STATUS_FILTERS — exactly what SEAM-06 allows
    });

    try {
      // The COUNT is unmoved: the lead is not MLS-removed, so it is still active. This is the
      // property the badge needs — a custom status must never make live work vanish from it.
      const after = await leadNavCounts(scopeA);
      expect(after.active).toBe(before.active);
      expect(after.total).toBe(before.total);

      // The default LIST, filtering by the enumerated six, now drops that lead. Asserted, not
      // wished away: this is the divergence, and it is the LIST's status filter that owns it.
      // Had `active` been defined as "status ∈ DEFAULT_STATUS_FILTERS", the badge would have
      // under-counted here too.
      const listed = await listLeads(scopeA, defaultQuery);
      expect(listed.total).toBe(before.active - 1);
      expect(listed.total).toBeLessThan(after.active);

      // With no status filter at all, the lead is back and the un-narrowed list agrees with
      // `active` again once the removed row is excluded by hand — proving the gap is the
      // enumerated set, not the count.
      const unfiltered = await listLeads(scopeA, { ...defaultQuery, statuses: [] });
      expect(unfiltered.total).toBe(after.total);
      expect(unfiltered.leads.filter((l) => l.status !== "Removed MLS")).toHaveLength(after.active);
    } finally {
      await db.delete(schema.leadStatusHistory).where(eq(schema.leadStatusHistory.leadId, target.id));
    }
  });
});
