import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { remindDueTasks } from "@/modules/notify/task-reminders";
import { saveNotificationPrefs } from "@/modules/notify/prefs";
import { utcDateString } from "@/modules/tasks/dates";
import { releaseTenantLeads } from "../helpers/hold";
import type { ScopeContext } from "@/lib/scope";

// WP-TSK-6 (TSK-08): the due-task reminder sweep that rides the drain-outbox cron.
// Proves the one-nudge-ever guarantee, the BINDING recipient rule (resolved THROUGH
// taskWhere for the recipient's own scope — WP-TSK-1 audit F-2), the partner hold /
// recall gates, per-channel prefs, and SEC-05 email content. Self-skips without
// DATABASE_URL. Run with node --env-file=.env.local.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-task-reminders";
const SLUG_PREFS = "test-task-reminders-prefs";

const APP_URL = "https://app.test";
const now = new Date();
const today = utcDateString(now);
const dayOffset = (days: number) => utcDateString(new Date(now.getTime() + days * 86_400_000));
const YESTERDAY = dayOffset(-1);
const TOMORROW = dayOffset(1);

// Seller PII on the worked lead — SEC-05's negative assertions target these exact values.
const SELLER = { first: "Marguerite", last: "Okonkwo", phone: "5125550142", email: "marguerite@seller.test" };

async function dropTenants(db: PostgresJsDatabase<typeof schema>, slugs: string[]) {
  const rows = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, slugs));
  const tids = rows.map((t) => t.id);
  if (tids.length === 0) return;
  await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
  await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.tenantId, tids));
  await db.delete(schema.settings).where(inArray(schema.settings.tenantId, tids));
  await db.delete(schema.leadTasks).where(inArray(schema.leadTasks.tenantId, tids));
  await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
  await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
  await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
  await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
  await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
}

suite("WP-TSK-6: due-task reminders (TSK-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  const REF_A = "LD-26-30001"; // admin-worked lead, owned by PX, released
  const REF_B = "LD-26-30002"; // partner-worked lead, owned by PX, released, carries seller PII
  const REF_REROUTED = "LD-26-30003"; // authored by PX, since re-routed to PY
  const REF_HELD = "LD-26-30004"; // owned by PX, still inside the distribution hold
  const REF_RECALLED = "LD-26-30005"; // owned by PX, soft-deleted (voided)

  const TITLE_ADMIN = "Chase the survey paperwork";
  const TITLE_PARTNER = "Door-knock before Friday";

  const sweep = () => remindDueTasks(db, { tenantId: id.tenant, appBaseUrl: APP_URL, today, now });
  const notificationsFor = (userId: string) =>
    db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, id.tenant), eq(schema.notifications.userId, userId)));
  const taskRow = async (taskId: string) =>
    (await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId)))[0];
  const dueEmails = () =>
    db
      .select()
      .from(schema.emailOutbox)
      .where(and(eq(schema.emailOutbox.tenantId, id.tenant), eq(schema.emailOutbox.kind, "task_due")));

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await dropTenants(db, [SLUG, SLUG_PREFS]);

    const [t] = await db.insert(schema.tenants).values({ name: "Task reminders", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;

    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222222", status: "active" }).returning({ id: schema.partners.id });

    id.admin = randomUUID();
    id.admin2 = randomUUID();
    id.pxUser = randomUUID();
    id.pyUser = randomUUID();
    await db.insert(schema.users).values([
      { id: id.admin, tenantId: t.id, email: "admin@tasks-rem.test", role: "admin" as const },
      { id: id.admin2, tenantId: t.id, email: "admin2@tasks-rem.test", role: "admin" as const },
      { id: id.pxUser, tenantId: t.id, email: "px@tasks-rem.test", role: "partner" as const, partnerId: px.id },
      { id: id.pyUser, tenantId: t.id, email: "py@tasks-rem.test", role: "partner" as const, partnerId: py.id },
    ]);

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-301", filename: "r.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const leadRows = await db
      .insert(schema.leads)
      .values([
        { tenantId: t.id, refId: REF_A, uploadId: up.id, dedupeKey: "ra|1", rawJson: {}, partnerId: px.id, city: "Austin", state: "TX", matchMethod: "zip" as const, mlsStatus: "kept" as const },
        {
          tenantId: t.id, refId: REF_B, uploadId: up.id, dedupeKey: "rb|2", rawJson: {}, partnerId: px.id,
          city: "Dallas", state: "TX", matchMethod: "zip" as const, mlsStatus: "kept" as const,
          sellerFirst: SELLER.first, sellerLast: SELLER.last, phone: SELLER.phone, email: SELLER.email,
        },
        { tenantId: t.id, refId: REF_REROUTED, uploadId: up.id, dedupeKey: "rc|3", rawJson: {}, partnerId: px.id, manualPartnerId: py.id, city: "Mesa", state: "AZ", matchMethod: "zip" as const, mlsStatus: "kept" as const },
        { tenantId: t.id, refId: REF_RECALLED, uploadId: up.id, dedupeKey: "re|5", rawJson: {}, partnerId: px.id, city: "Reno", state: "NV", matchMethod: "zip" as const, mlsStatus: "kept" as const, deletedAt: new Date() },
      ])
      .returning({ id: schema.leads.id, refId: schema.leads.refId });
    // Release everything past the distribution hold…
    await releaseTenantLeads(db, id.tenant);
    // …then add the still-HELD lead (fresh created_at, so the hold window has NOT elapsed).
    const [held] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: REF_HELD, uploadId: up.id, dedupeKey: "rd|4", rawJson: {}, partnerId: px.id, city: "Plano", state: "TX", matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    const leadId = new Map(leadRows.map((l) => [l.refId, l.id]));
    leadId.set(REF_HELD, held.id);

    const adminTask = { tenantId: t.id, authorRole: "admin" as const, authorUserId: id.admin, assignedToUserId: id.admin };
    const pxTask = { tenantId: t.id, authorRole: "partner" as const, authorUserId: id.pxUser, assignedToUserId: id.pxUser };
    const inserted = await db
      .insert(schema.leadTasks)
      .values([
        // 1 — plain admin overdue task: the happy path.
        { ...adminTask, leadId: leadId.get(REF_A)!, title: TITLE_ADMIN, dueOn: YESTERDAY },
        // 2 — due TODAY (the boundary of `due_on <= today`), a different admin recipient.
        { ...adminTask, leadId: leadId.get(REF_A)!, title: "Due today", dueOn: today, authorUserId: id.admin2, assignedToUserId: id.admin2 },
        // 3 — partner stream on a released, currently-owned lead.
        { ...pxTask, leadId: leadId.get(REF_B)!, title: TITLE_PARTNER, dueOn: YESTERDAY },
        // 4 — BINDING: assignee is on the far side of the PRN-13 stream wall (a partner user
        //     holding an admin task — reachable by a mis-wired write or a legacy row).
        { ...adminTask, leadId: leadId.get(REF_A)!, title: "Cross-stream assignee", dueOn: YESTERDAY, assignedToUserId: id.pxUser },
        // 5 — BINDING: partner task whose lead has been re-routed away from the author's org,
        //     so NEITHER assignee nor author can read it any more.
        { ...pxTask, leadId: leadId.get(REF_REROUTED)!, title: "Re-routed away", dueOn: YESTERDAY },
        // 6 — partner task on a lead still inside the distribution hold.
        { ...pxTask, leadId: leadId.get(REF_HELD)!, title: "Held lead", dueOn: YESTERDAY },
        // 7 — partner task on a RECALLED (soft-deleted) lead.
        { ...pxTask, leadId: leadId.get(REF_RECALLED)!, title: "Recalled lead", dueOn: YESTERDAY },
        // 8/9/10 — never swept: future-dated, undated, already done.
        { ...adminTask, leadId: leadId.get(REF_A)!, title: "Future", dueOn: TOMORROW },
        { ...adminTask, leadId: leadId.get(REF_A)!, title: "Undated", dueOn: null },
        { ...adminTask, leadId: leadId.get(REF_A)!, title: "Done", dueOn: YESTERDAY, doneAt: new Date() },
      ])
      .returning({ id: schema.leadTasks.id, title: schema.leadTasks.title });
    for (const row of inserted) id[`task:${row.title}`] = row.id;
    id.tAdmin = id[`task:${TITLE_ADMIN}`];
    id.tPartner = id[`task:${TITLE_PARTNER}`];
  });

  afterAll(async () => {
    await dropTenants(db, [SLUG]);
    await client.end();
  });

  it("TSK-08: an open task past due gets exactly one in-app + one email nudge; reminded_at stamped", async () => {
    // 4 nudged: admin-overdue, due-today, partner, and the cross-stream one (via its author).
    expect((await sweep()).reminded).toBe(4);

    const admin = await notificationsFor(id.admin);
    expect(admin.filter((n) => n.type === "task_due" && n.title === `Task due: ${TITLE_ADMIN}`)).toHaveLength(1);
    // Deep link follows the admin convention (the leads dialog), not the retired detail page.
    expect(admin.find((n) => n.title === `Task due: ${TITLE_ADMIN}`)!.deepLink).toBe(`/leads?open=${REF_A}`);

    const partner = await notificationsFor(id.pxUser);
    expect(partner.filter((n) => n.title === `Task due: ${TITLE_PARTNER}`)).toHaveLength(1);
    expect(partner.find((n) => n.title === `Task due: ${TITLE_PARTNER}`)!.deepLink).toBe(`/portal/leads/${REF_B}`);

    // One email each, addressed to the recipient USER (a task is a person's work item).
    const emails = await dueEmails();
    expect(emails).toHaveLength(4);
    expect(emails.filter((e) => e.toAddress === "admin@tasks-rem.test")).toHaveLength(2); // own + cross-stream fallback
    expect(emails.filter((e) => e.toAddress === "admin2@tasks-rem.test")).toHaveLength(1);
    expect(emails.filter((e) => e.toAddress === "px@tasks-rem.test")).toHaveLength(1);

    expect((await taskRow(id.tAdmin)).remindedAt).not.toBeNull();
    expect((await taskRow(id.tPartner)).remindedAt).not.toBeNull();
  });

  it("TSK-08: a second sweep run produces no duplicate nudge", async () => {
    const before = (await dueEmails()).length;
    expect((await sweep()).reminded).toBe(0);
    expect((await sweep()).reminded).toBe(0);
    expect(await dueEmails()).toHaveLength(before);
    // Still exactly one in-app nudge for the admin's own task.
    const admin = await notificationsFor(id.admin);
    expect(admin.filter((n) => n.title === `Task due: ${TITLE_ADMIN}`)).toHaveLength(1);
  });

  it("TSK-08: a reminder is never sent to a recipient who cannot read the task — falls back to the author", async () => {
    // The cross-stream assignee (a partner user holding an admin task) is resolved through
    // taskWhere for THEIR scope, sees nothing, and is never told: the author gets it instead.
    const px = await notificationsFor(id.pxUser);
    expect(px.some((n) => n.title === "Task due: Cross-stream assignee")).toBe(false);
    const admin = await notificationsFor(id.admin);
    expect(admin.filter((n) => n.title === "Task due: Cross-stream assignee")).toHaveLength(1);
    expect((await dueEmails()).some((e) => e.toAddress === "px@tasks-rem.test" && e.subject.includes(REF_A))).toBe(false);

    // …and when the AUTHOR cannot read it either (lead re-routed away from their org), the
    // sweep skips silently: no nudge to anyone, and reminded_at stays NULL so a future
    // re-assignment can still be nudged.
    const orphan = await taskRow(id["task:Re-routed away"]);
    expect(orphan.remindedAt).toBeNull();
    const all = await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, id.tenant));
    expect(all.some((n) => n.title === "Task due: Re-routed away")).toBe(false);
    expect(await notificationsFor(id.pyUser)).toHaveLength(0); // the new owner is not the author
  });

  it("TSK-08: partner recipient is not notified for a held or recalled lead's task", async () => {
    for (const title of ["Held lead", "Recalled lead"]) {
      expect((await taskRow(id[`task:${title}`])).remindedAt).toBeNull();
      const px = await notificationsFor(id.pxUser);
      expect(px.some((n) => n.title === `Task due: ${title}`)).toBe(false);
      expect((await dueEmails()).some((e) => e.body.includes(title))).toBe(false);
    }
  });

  it("TSK-08: undated, future-dated and completed tasks are never swept", async () => {
    for (const title of ["Undated", "Future", "Done"]) {
      expect((await taskRow(id[`task:${title}`])).remindedAt).toBeNull();
    }
    expect((await dueEmails()).some((e) => e.body.includes("Undated") || e.body.includes("Future"))).toBe(false);
  });

  it("TSK-08/SEC-05: the email contains ref + city/state + title and no seller PII", async () => {
    const email = (await dueEmails()).find((e) => e.toAddress === "px@tasks-rem.test")!;
    const surface = `${email.subject}\n${email.body}\n${email.html ?? ""}`;
    expect(email.body).toContain(REF_B);
    expect(email.body).toContain("Dallas, TX");
    expect(email.body).toContain(TITLE_PARTNER);
    for (const secret of [SELLER.first, SELLER.last, SELLER.phone, SELLER.email]) {
      expect(surface).not.toContain(secret);
    }
  });
});

// Prefs are per tenant, so the channel matrix gets its own tenant — otherwise it would
// have to fight the default-on assertions above.
suite("TSK-08: notification prefs gate each channel independently", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await dropTenants(db, [SLUG_PREFS]);

    const [t] = await db.insert(schema.tenants).values({ name: "Task reminder prefs", slug: SLUG_PREFS }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    id.admin = randomUUID();
    id.pxUser = randomUUID();
    await db.insert(schema.users).values([
      { id: id.admin, tenantId: t.id, email: "admin@tasks-prefs.test", role: "admin" as const },
      { id: id.pxUser, tenantId: t.id, email: "px@tasks-prefs.test", role: "partner" as const, partnerId: px.id },
    ]);
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-302", filename: "p.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [lead] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-30101", uploadId: up.id, dedupeKey: "pf|1", rawJson: {}, partnerId: px.id, city: "Tulsa", state: "OK", matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    await releaseTenantLeads(db, id.tenant);
    await db.insert(schema.leadTasks).values([
      { tenantId: t.id, leadId: lead.id, title: "Admin pref task", authorRole: "admin", authorUserId: id.admin, assignedToUserId: id.admin, dueOn: YESTERDAY },
      { tenantId: t.id, leadId: lead.id, title: "Partner pref task", authorRole: "partner", authorUserId: id.pxUser, assignedToUserId: id.pxUser, dueOn: YESTERDAY },
    ]);

    // Opposite halves of the matrix: admin keeps in-app only, partner keeps email only.
    const scope: ScopeContext = { tenantId: id.tenant, role: "admin", userId: id.admin };
    await saveNotificationPrefs(db, scope, {
      admin: { task_due: { email: false, inApp: true } },
      partner: { task_due: { email: true, inApp: false } },
    });
  });

  afterAll(async () => {
    await dropTenants(db, [SLUG_PREFS]);
    await client.end();
  });

  it("TSK-08: prefs off → channel suppressed", async () => {
    expect((await remindDueTasks(db, { tenantId: id.tenant, appBaseUrl: APP_URL, today, now })).reminded).toBe(2);

    const emails = await db
      .select()
      .from(schema.emailOutbox)
      .where(and(eq(schema.emailOutbox.tenantId, id.tenant), eq(schema.emailOutbox.kind, "task_due")));
    const notifs = await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, id.tenant));

    // Admin: in-app only.
    expect(notifs.some((n) => n.userId === id.admin && n.title === "Task due: Admin pref task")).toBe(true);
    expect(emails.some((e) => e.toAddress === "admin@tasks-prefs.test")).toBe(false);
    // Partner: email only.
    expect(emails.filter((e) => e.toAddress === "px@tasks-prefs.test")).toHaveLength(1);
    expect(notifs.some((n) => n.userId === id.pxUser)).toBe(false);
    // Both were still consumed exactly once — a suppressed channel is not a retry signal.
    const tasks = await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.tenantId, id.tenant));
    expect(tasks.every((t) => t.remindedAt !== null)).toBe(true);
  });
});
