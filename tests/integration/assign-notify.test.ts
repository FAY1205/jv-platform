import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { notifyLeadAssigned } from "@/modules/notify/outbox";
import { saveNotificationPrefs } from "@/modules/notify/prefs";

// F-40 / ADR-0020: an admin manual-assign / re-route notifies the RECEIVING partner
// (the signal that was previously missing). Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-assign-notify-ws9";

suite("F-40: receiving partner is notified on assign/re-route", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [schema.notifications, schema.settings, schema.users, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Assign Notify", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    // PX has an onboarded user; PY does not.
    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222222", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.py = py.id;
    id.adminUser = randomUUID();
    id.pxUser = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@an.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@an.test", role: "partner", partnerId: px.id });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const admin = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminUser });

  async function pxNotifications() {
    return db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, id.tenant), eq(schema.notifications.userId, id.pxUser)));
  }

  it("F-40: assigning to a partner with a user creates one in-app notification", async () => {
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00099", partnerId: id.px });
    const rows = await pxNotifications();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("assigned_lead");
    expect(rows[0].title).toContain("LD-26-00099");
    expect(rows[0].deepLink).toBe("/portal/leads/LD-26-00099");
    expect(rows[0].readAt).toBeNull();
  });

  it("F-40: a partner with no onboarded user is skipped (no crash, no orphan row)", async () => {
    const before = (await pxNotifications()).length;
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00100", partnerId: id.py });
    const all = await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, id.tenant));
    expect(all).toHaveLength(before); // no new notification for the userless partner
  });

  it("F-40: honors the partner's in-app new_leads preference (off => no notification)", async () => {
    await saveNotificationPrefs(db, admin(), { partner: { new_leads: { inApp: false } } });
    const before = (await pxNotifications()).length;
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00101", partnerId: id.px });
    expect((await pxNotifications()).length).toBe(before); // suppressed by pref
  });
});
