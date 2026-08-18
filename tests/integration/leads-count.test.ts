import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { leadNavCounts } from "@/modules/leads/queries";
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

  async function cleanup() {
    const t = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
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
    const [ua] = await db.insert(schema.uploads).values({ tenantId: ta.id, refId: "IM-26-101", status: "processed", filename: "a.csv" }).returning({ id: schema.uploads.id });
    const [ub] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "IM-26-201", status: "processed", filename: "b.csv" }).returning({ id: schema.uploads.id });
    const mk = (tenantId: string, uploadId: string, v?: Partial<typeof schema.leads.$inferInsert>) =>
      db.insert(schema.leads).values({ tenantId, refId: `LD-26-${Math.floor(Math.random() * 100000)}`, uploadId, dedupeKey: randomUUID(), rawJson: {}, mlsStatus: "kept", matchMethod: "none", ...v });
    await mk(ta.id, ua.id);
    await mk(ta.id, ua.id);
    // MLS-removed → counted in the total, but NOT part of the unmatched backlog (C-41d).
    await mk(ta.id, ua.id, { mlsStatus: "removed" });
    await mk(ta.id, ua.id, { deletedAt: new Date() }); // soft-deleted → excluded (F-2)
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
    expect(counts).toEqual({ total: 3, unmatched: 2 });
    expect(counts.unmatched).toBeLessThanOrEqual(counts.total);
  });
});
