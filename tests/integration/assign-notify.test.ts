import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { notifyLeadAssigned, notifyLeadsBulkAssigned } from "@/modules/notify/outbox";
import { saveSubjectOverride, type PrefOverrideValue } from "@/modules/notify/pref-overrides";

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
    for (const tbl of [schema.notifications, schema.emailOutbox, schema.notificationPrefOverrides, schema.settings, schema.users, schema.partners]) {
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
    // NTF-07: PX is a MULTI-SEAT org (created_at pinned so the fan-out order is assertable),
    // plus a deactivated seat that must receive nothing (NTF-06).
    id.pxUser2 = randomUUID();
    id.pxGone = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@an.test", role: "admin" });
    await db.insert(schema.users).values([
      { id: id.pxUser, tenantId: t.id, email: "px@an.test", role: "partner" as const, partnerId: px.id, createdAt: new Date("2026-04-01T00:00:00.000Z") },
      { id: id.pxUser2, tenantId: t.id, email: "px2@an.test", role: "partner" as const, partnerId: px.id, createdAt: new Date("2026-04-02T00:00:00.000Z") },
      {
        id: id.pxGone, tenantId: t.id, email: "pxgone@an.test", role: "partner" as const, partnerId: px.id,
        createdAt: new Date("2026-04-03T00:00:00.000Z"), deactivatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ]);
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

  const allNotifications = () =>
    db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, id.tenant));
  const allEmails = () =>
    db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, id.tenant));
  const reset = async () => {
    await db.delete(schema.notifications).where(eq(schema.notifications.tenantId, id.tenant));
    await db.delete(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, id.tenant));
    await db.delete(schema.notificationPrefOverrides).where(eq(schema.notificationPrefOverrides.tenantId, id.tenant));
  };

  /** WP-NF2b: preferences are PER SEAT. These suites used to set one workspace matrix row; now
   *  they set the same value on every seat the fan-out will reach, which is what the retired
   *  matrix effectively meant for this org. */
  const setSeatPrefs = async (value: PrefOverrideValue, userIds: string[] = [id.pxUser, id.pxUser2]) => {
    for (const userId of userIds) await saveSubjectOverride(db, id.tenant, { userId }, value);
  };

  it("F-40: assigning to a partner with a user creates one in-app notification", async () => {
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00099", partnerId: id.px });
    const rows = await pxNotifications();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("assigned_lead");
    expect(rows[0].title).toContain("LD-26-00099");
    expect(rows[0].deepLink).toBe("/portal/leads/LD-26-00099");
    expect(rows[0].readAt).toBeNull();
    expect(rows[0].leadRef).toBe("LD-26-00099"); // C-13: correlated for void/purge redaction
  });

  it("NTF-07/NTF-06: EVERY active seat of the receiving org is notified; a deactivated seat is not", async () => {
    // WP-NF1 D3: this used to take the FIRST row an unordered select happened to return, so a
    // two-person partner org told exactly one person — and which one was up to the planner.
    await reset();
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00110", partnerId: id.px });
    const rows = await allNotifications();
    expect(rows.map((n) => n.userId).sort()).toEqual([id.pxUser, id.pxUser2].sort());
    expect(rows.some((n) => n.userId === id.pxGone)).toBe(false);
    expect(rows.every((n) => n.title === "Lead LD-26-00110 was assigned to you")).toBe(true);
  });

  it("F-40: a partner with no onboarded user is skipped (no crash, no orphan row)", async () => {
    const before = (await allNotifications()).length;
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00100", partnerId: id.py });
    expect(await allNotifications()).toHaveLength(before); // nothing for the userless partner
  });

  it("NTF-08: gated on assigned_lead — NOT on new_leads (the distribution signal)", async () => {
    // WP-NF1 D4: the two signals used to share one preference row, so the Settings toggle
    // labelled "New leads distributed to you" silently governed manual re-routes too.
    await reset();
    await setSeatPrefs({ events: { new_leads: { inApp: false, email: false } } });
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00120", partnerId: id.px });
    expect((await allNotifications()).length).toBe(2); // both seats — new_leads is irrelevant here

    await reset();
    await setSeatPrefs({ events: { assigned_lead: { inApp: false, email: false } } });
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00121", partnerId: id.px });
    expect(await allNotifications()).toHaveLength(0); // suppressed by its OWN pref
    expect(await allEmails()).toHaveLength(0);
  });

  it("NTF-08: the email channel is HONOURED, per seat, so the Settings toggle is truthful", async () => {
    // Default is email-off (today's behavior preserved); turning it on must actually send —
    // a checkbox that does nothing is worse than no checkbox.
    await reset();
    await setSeatPrefs({ events: { assigned_lead: { inApp: true, email: true } } });
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00130", partnerId: id.px });

    const emails = await allEmails();
    // A per-USER notification emails the SEAT address, never the org address (partners.email),
    // which stays the digest/alert surface.
    expect(emails.map((e) => e.toAddress).sort()).toEqual(["px2@an.test", "px@an.test"]);
    expect(emails.every((e) => e.kind === "assigned_lead")).toBe(true);
    expect(emails[0].subject).toContain("LD-26-00130");
    expect(emails.every((e) => (e.meta as { leadRef?: string } | null)?.leadRef === "LD-26-00130")).toBe(true);
    // SEC-05: the lead REF only — the assign path never learns seller PII, and must not invent any.
    expect(emails.every((e) => e.html?.includes("<!DOCTYPE html>"))).toBe(true);
  });

  it("NTF-08: email-only prefs send the mail and create NO in-app row (channels are independent)", async () => {
    await reset();
    await setSeatPrefs({ events: { assigned_lead: { inApp: false, email: true } } });
    await notifyLeadAssigned(db, admin(), { leadRef: "LD-26-00131", partnerId: id.px });
    expect(await allNotifications()).toHaveLength(0);
    expect(await allEmails()).toHaveLength(2);
  });

  it("NTF-07/S6: a bulk assign is ONE summary per seat, not one per lead", async () => {
    await reset();
    await setSeatPrefs({ events: { assigned_lead: { inApp: true, email: false } } });
    await notifyLeadsBulkAssigned(db, admin(), { partnerId: id.px, count: 40 });
    const rows = await allNotifications();
    expect(rows).toHaveLength(2); // one per active seat, not 40 and not 80
    expect(rows.map((n) => n.userId).sort()).toEqual([id.pxUser, id.pxUser2].sort());
    expect(rows.every((n) => n.title === "40 leads were assigned to you")).toBe(true);
    expect(rows.every((n) => n.deepLink === "/portal/leads")).toBe(true);
    // An aggregate spans many leads, so it carries no lead_ref to redact by (C-13).
    expect(rows.every((n) => n.leadRef === null)).toBe(true);
    // A single-lead batch still takes the per-lead deep-link path, not this one.
    await reset();
    await notifyLeadsBulkAssigned(db, admin(), { partnerId: id.px, count: 1 });
    expect(await allNotifications()).toHaveLength(0);
  });
});
