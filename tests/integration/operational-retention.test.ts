import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { randomUUID } from "node:crypto";
import {
  sweepIdempotencyKeys,
  sweepEmailOutbox,
  sweepAiFeedback,
  sweepNotifications,
  sweepSavedViewsPii,
} from "@/modules/retention/operational";

// WP-RET-2 (audit R-42/R-43/R-91 / SET-07): retention for the three tenant-scoped operational
// tables that grew without bound. Age-based delete-only sweeps; pending emails are never pruned.
// Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-operational-retention";

suite("WP-RET-2: operational-table retention sweeps", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let tenantId: string;
  const now = new Date("2026-07-13T00:00:00.000Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const veryOld = daysAgo(100); // past every cutoff (7d / 30d / 90d)
  const recent = daysAgo(1); // within every retention window

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.idempotencyKeys).where(inArray(schema.idempotencyKeys.tenantId, tids));
    await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.tenantId, tids));
    await db.delete(schema.aiFeedback).where(inArray(schema.aiFeedback.tenantId, tids));
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
    await db.delete(schema.savedViews).where(inArray(schema.savedViews.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  let userId: string;

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Operational Retention", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    userId = randomUUID();
    await db.insert(schema.users).values({ id: userId, tenantId, email: "op-ret@test.dev", role: "admin" });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("R-42: sweepIdempotencyKeys deletes rows past the 7-day window, keeps recent", async () => {
    await db.insert(schema.idempotencyKeys).values([
      { tenantId, key: "op-old", status: "completed", createdAt: veryOld },
      { tenantId, key: "op-recent", status: "completed", createdAt: recent },
    ]);
    const { deleted } = await sweepIdempotencyKeys(db, { now });
    expect(deleted).toBe(1);
    const rows = await db.select({ key: schema.idempotencyKeys.key }).from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.tenantId, tenantId));
    expect(rows.map((r) => r.key).sort()).toEqual(["op-recent"]);
  });

  it("R-43: sweepEmailOutbox deletes aged sent/failed rows but NEVER a pending one", async () => {
    const base = { tenantId, toAddress: "x@example.com", subject: "s", body: "b", kind: "partner_digest" as const };
    await db.insert(schema.emailOutbox).values([
      { ...base, status: "sent", createdAt: veryOld }, // aged + terminal → deleted
      { ...base, status: "failed", createdAt: veryOld }, // aged + terminal → deleted
      { ...base, status: "pending", createdAt: veryOld }, // aged but PENDING → kept (still to deliver)
      { ...base, status: "sent", createdAt: recent }, // recent terminal → kept
    ]);
    const { deleted } = await sweepEmailOutbox(db, { now });
    expect(deleted).toBe(2);
    const rows = await db.select({ status: schema.emailOutbox.status, createdAt: schema.emailOutbox.createdAt }).from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, tenantId));
    expect(rows.length).toBe(2);
    // the aged pending row survived
    expect(rows.some((r) => r.status === "pending")).toBe(true);
    // no aged terminal row survived
    expect(rows.some((r) => r.status !== "pending" && r.createdAt.getTime() <= veryOld.getTime())).toBe(false);
  });

  it("C-13/WP-RET-3a: sweepNotifications deletes rows past the 90-day window, keeps recent", async () => {
    await db.insert(schema.notifications).values([
      { tenantId, userId, type: "task_due", title: "Task due: old", createdAt: veryOld }, // aged → deleted
      { tenantId, userId, type: "task_due", title: "Task due: fresh", createdAt: recent }, // within window → kept
    ]);
    const { deleted } = await sweepNotifications(db, { now });
    expect(deleted).toBe(1);
    const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, tenantId));
    expect(rows.map((r) => r.title)).toEqual(["Task due: fresh"]);
  });

  it("C-13/WP-RET-3b: sweepSavedViewsPii clears the q search string on stale views, keeps the view + recent views' q", async () => {
    const mkFilters = (q: string) => ({ q, partnerId: "", state: "", source: "", statuses: [], hot: false, tags: [], dateFrom: "", dateTo: "", viewMode: "list" });
    // saved_views' q-clear window is 12 MONTHS (not 7/30/90d) — the stale one must be >365d old.
    const veryVeryOld = daysAgo(400);
    await db.insert(schema.savedViews).values([
      { tenantId, userId, name: "stale view", filters: mkFilters("seller Jane 555-867-5309"), createdAt: veryVeryOld, updatedAt: veryVeryOld }, // >12mo → q cleared
      { tenantId, userId, name: "recent view", filters: mkFilters("active search 555"), createdAt: recent, updatedAt: recent }, // within window → untouched
    ]);
    const { cleared } = await sweepSavedViewsPii(db, { now });
    expect(cleared).toBe(1);
    const rows = await db.select().from(schema.savedViews).where(eq(schema.savedViews.tenantId, tenantId));
    const byName = Object.fromEntries(rows.map((r) => [r.name, (r.filters as { q: string }).q]));
    expect(byName["stale view"]).toBe(""); // PII search string cleared…
    expect(byName["recent view"]).toBe("active search 555"); // …recent view untouched
    // The stale VIEW survives (non-destructive) — only its q was cleared.
    expect(rows.map((r) => r.name).sort()).toEqual(["recent view", "stale view"]);
    // Idempotent: a second pass clears nothing (q is now "").
    expect((await sweepSavedViewsPii(db, { now })).cleared).toBe(0);
  });

  it("R-91: sweepAiFeedback deletes rows past the 90-day window, keeps recent", async () => {
    await db.insert(schema.aiFeedback).values([
      { tenantId, messageId: "m-old", rating: "up", createdAt: veryOld },
      { tenantId, messageId: "m-recent", rating: "down", createdAt: recent },
    ]);
    const { deleted } = await sweepAiFeedback(db, { now });
    expect(deleted).toBe(1);
    const rows = await db.select({ messageId: schema.aiFeedback.messageId }).from(schema.aiFeedback).where(eq(schema.aiFeedback.tenantId, tenantId));
    expect(rows.map((r) => r.messageId).sort()).toEqual(["m-recent"]);
  });

  it("R-43: the sweep is idempotent — a second pass over already-clean data deletes nothing", async () => {
    const { deleted } = await sweepEmailOutbox(db, { now });
    expect(deleted).toBe(0);
  });
});
