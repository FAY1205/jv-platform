import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { listRunsPage } from "@/modules/run/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG_A = "test-runs-list-t4-a";
const SLUG_B = "test-runs-list-t4-b";

const DAY = 86_400_000;

suite("T4: listRunsPage — paginated + date-filtered imports list (FEP-03, PRN-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let base: number; // "now" anchor for the seeded created_at spread

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    base = Date.now();

    // Tenant A — 12 uploads, one per day going back (newest first when listed).
    const [tA] = await db.insert(schema.tenants).values({ name: "T4 A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    scope = { tenantId: tA.id, role: "admin", userId: randomUUID() };
    for (let i = 0; i < 12; i++) {
      await db.insert(schema.uploads).values({
        tenantId: tA.id, refId: `IM-26-9${String(i).padStart(2, "0")}`, filename: `t4-${i}.xlsx`,
        status: "processed", rowCount: 5, createdAt: new Date(base - i * DAY),
      });
    }

    // Tenant B — an upload INSIDE tenant A's date window (must never leak into A's list/total).
    const [tB] = await db.insert(schema.tenants).values({ name: "T4 B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    await db.insert(schema.uploads).values({
      tenantId: tB.id, refId: "IM-26-999", filename: "other-tenant.xlsx",
      status: "processed", rowCount: 5, createdAt: new Date(base - 1 * DAY),
    });
  });

  afterAll(async () => { await cleanup(); await client.end(); });

  it("T4-01 (FEP-03): pageSize=10 returns 10 newest-first rows with the full total; page 2 has the rest", async () => {
    const p1 = await listRunsPage(scope, { page: 1, pageSize: 10 });
    expect(p1.runs).toHaveLength(10);
    expect(p1.total).toBe(12);
    expect(p1.runs[0].refId).toBe("IM-26-900"); // newest first
    const p2 = await listRunsPage(scope, { page: 2, pageSize: 10 });
    expect(p2.runs).toHaveLength(2);
    expect(p2.total).toBe(12);
  });

  it("T4-02: the processed-date filter bounds rows AND total identically (count-consistency)", async () => {
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    // A window covering the 3 most recent uploads (days 0..2), padded so UTC day
    // boundaries can't clip the newest/oldest edge of the window.
    const res = await listRunsPage(scope, { dateFrom: iso(base - 2 * DAY - DAY / 2), dateTo: iso(base + DAY / 2) });
    expect(res.total).toBe(res.runs.length);
    expect(res.runs.length).toBeGreaterThanOrEqual(2);
    expect(res.runs.length).toBeLessThanOrEqual(4);
    for (const r of res.runs) expect(new Date(r.createdAt).getTime()).toBeGreaterThan(base - 4 * DAY);
    // Tenant B's IM-26-999 sits INSIDE this window — the date-filtered path must
    // exclude it too, not just the unfiltered path (audit-tenancy F-2).
    expect(res.runs.some((r) => r.refId === "IM-26-999")).toBe(false);
  });

  it("T4-03 (PRN-08/TST-01): another tenant's uploads never appear in the rows or the total", async () => {
    const all = await listRunsPage(scope, { page: 1, pageSize: 50 });
    expect(all.total).toBe(12); // tenant B's IM-26-999 not counted
    expect(all.runs.some((r) => r.refId === "IM-26-999")).toBe(false);
  });

  it("T4-04: garbage paging degrades to defaults, never throws", async () => {
    const res = await listRunsPage(scope, { page: -3, pageSize: 999 as never });
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(20);
    expect(res.runs.length).toBe(12);
  });
});
