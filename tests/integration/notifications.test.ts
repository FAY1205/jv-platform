import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { enqueueRunDigests, notifyStatusChange } from "@/modules/notify/outbox";
import { listNotifications, unreadCount, markRead } from "@/modules/notify/notifications";
import { DEFAULT_NOTIFICATION_PREFS, mergeNotificationPrefs } from "@/modules/notify/prefs";
import type { ScopeContext } from "@/lib/scope";
import type { RunSummary } from "@/modules/analytics/run-summary";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-notif-wp029";

suite("WP-029: notification center + prefs (NTF-04/05)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let adminScope: ScopeContext;
  let partnerScope: ScopeContext;
  const summary: RunSummary = { total: 2, kept: 2, removed: 0, unmatched: 0, previouslyMatched: 0, perPartner: [] };

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [schema.notifications, schema.emailOutbox, schema.settings, schema.leads, schema.uploads, schema.users, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Notif", slug: SLUG }).returning({ id: schema.tenants.id });
    const [p] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", email: "alpha@p.test", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const adminUserId = randomUUID();
    const partnerUserId = randomUUID();
    await db.insert(schema.users).values([
      { id: adminUserId, tenantId: t.id, email: "admin@t.test", role: "admin" },
      { id: partnerUserId, tenantId: t.id, email: "alpha@p.test", role: "partner", partnerId: p.id },
    ]);
    adminScope = { tenantId: t.id, role: "admin", userId: adminUserId };
    partnerScope = { tenantId: t.id, role: "partner", userId: partnerUserId, partnerId: p.id };

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "UP-2026-020", filename: "w.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values([
      { tenantId: t.id, refId: "LD-2026-00001", uploadId: up.id, dedupeKey: "1|75001", rawJson: {}, partnerId: p.id, city: "Austin", state: "TX", mlsStatus: "kept" },
      { tenantId: t.id, refId: "LD-2026-00002", uploadId: up.id, dedupeKey: "2|75002", rawJson: {}, partnerId: p.id, city: "Dallas", state: "TX", mlsStatus: "kept" },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("NTF-04/05: run fan-out creates in-app notifications for the partner + admin, each scoped to their user", async () => {
    await enqueueRunDigests(db, adminScope, {
      uploadRef: "UP-2026-020",
      summary,
      portalBaseUrl: "https://app.test",
      adminEmails: ["admin@t.test"],
      adminUserId: adminScope.userId,
      prefs: DEFAULT_NOTIFICATION_PREFS,
    });

    const partnerNotifs = await listNotifications(partnerScope);
    expect(partnerNotifs).toHaveLength(1);
    expect(partnerNotifs[0].type).toBe("new_leads");
    expect(partnerNotifs[0].deepLink).toBe("/portal/leads");

    const adminNotifs = await listNotifications(adminScope);
    expect(adminNotifs.some((n) => n.type === "run_summary" && n.deepLink === "/runs/UP-2026-020")).toBe(true);
    // scoping: the partner never sees the admin's run_summary.
    expect(partnerNotifs.some((n) => n.type === "run_summary")).toBe(false);

    expect(await unreadCount(partnerScope)).toBe(1);
    await markRead(partnerScope, partnerNotifs[0].id);
    expect(await unreadCount(partnerScope)).toBe(0);
  });

  it("NTF-05: with the partner's in-app channel off, no partner notification is created", async () => {
    await db.delete(schema.notifications).where(eq(schema.notifications.tenantId, partnerScope.tenantId));
    const prefs = mergeNotificationPrefs({ partner: { new_leads: { email: true, inApp: false } } });
    await enqueueRunDigests(db, adminScope, {
      uploadRef: "UP-2026-020",
      summary,
      portalBaseUrl: "https://app.test",
      adminEmails: [],
      adminUserId: adminScope.userId,
      prefs,
    });
    expect(await listNotifications(partnerScope)).toHaveLength(0);
  });

  it("NTF-02/04: a partner status change notifies the admin in-app", async () => {
    await db.delete(schema.notifications).where(eq(schema.notifications.tenantId, adminScope.tenantId));
    await notifyStatusChange(db, partnerScope, { leadRef: "LD-2026-00001", status: "Contacted" });
    const adminNotifs = await listNotifications(adminScope);
    expect(adminNotifs.some((n) => n.type === "status_change" && n.title.includes("Contacted"))).toBe(true);
  });
});
