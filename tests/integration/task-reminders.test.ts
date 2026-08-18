import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { remindDueTasks, REMINDER_ATTEMPTS_MAX } from "@/modules/notify/task-reminders";
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
const SLUG_SCOPE = "test-task-reminders-scope";
const SLUG_SCOPE_B = "test-task-reminders-scope-b";
const SLUG_MECH = "test-task-reminders-mech";

// The transactionality case (audit-tenancy F-6.5) needs one notification insert to fail INSIDE
// the claim transaction. The flag is inert (straight passthrough) for every other case in this
// file, so the mock cannot perturb the suites above.
const mockState = vi.hoisted(() => ({ failNotifications: false }));
vi.mock("@/modules/notify/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/notify/notifications")>();
  return {
    ...actual,
    createNotification: async (...args: Parameters<typeof actual.createNotification>) => {
      if (mockState.failNotifications) throw new Error("notification insert exploded");
      return actual.createNotification(...args);
    },
  };
});

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
  let updatedAtBefore: Date;
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
        // 8 — ADMIN task on the same recalled lead. taskWhere's admin arm is lead-blind, so the
        //     due-select's deletedAt filter is the ONLY thing standing between a voided lead and
        //     an email carrying its (now sentinelled) title — pinned by its own case below.
        { ...adminTask, leadId: leadId.get(REF_RECALLED)!, title: "Admin recalled", dueOn: YESTERDAY },
        // 9/10/11 — never swept: future-dated, undated, already done.
        { ...adminTask, leadId: leadId.get(REF_A)!, title: "Future", dueOn: TOMORROW },
        { ...adminTask, leadId: leadId.get(REF_A)!, title: "Undated", dueOn: null },
        { ...adminTask, leadId: leadId.get(REF_A)!, title: "Done", dueOn: YESTERDAY, doneAt: new Date() },
      ])
      .returning({ id: schema.leadTasks.id, title: schema.leadTasks.title, updatedAt: schema.leadTasks.updatedAt });
    for (const row of inserted) id[`task:${row.title}`] = row.id;
    id.tAdmin = id[`task:${TITLE_ADMIN}`];
    id.tPartner = id[`task:${TITLE_PARTNER}`];
    updatedAtBefore = inserted.find((r) => r.title === TITLE_ADMIN)!.updatedAt;
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

  it("TSK-08: an admin task on a recalled lead is never nudged", async () => {
    // The admin arm of taskWhere is lead-blind by design, so this leg has exactly ONE guard:
    // the due-select's isNull(leads.deletedAt). A void has already replaced the title with the
    // redaction sentinel, so a nudge here would be both useless and a PII-adjacent email.
    expect((await taskRow(id["task:Admin recalled"])).remindedAt).toBeNull();
    const admin = await notificationsFor(id.admin);
    expect(admin.some((n) => n.title === "Task due: Admin recalled")).toBe(false);
    expect((await dueEmails()).some((e) => e.body.includes("Admin recalled"))).toBe(false);
    expect((await dueEmails()).some((e) => e.subject.includes(REF_RECALLED))).toBe(false);
  });

  it("TSK-08: a system stamp never touches updated_at", async () => {
    // reminded_at is a system marker, not a user edit: bumping updated_at would reorder
    // "recently changed" views and make the sweep look like someone edited the task.
    const after = (await taskRow(id.tAdmin)).updatedAt;
    expect(after.getTime()).toBe(updatedAtBefore.getTime());
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

// ─────────────────────────────────────────────────────────────────────────────
// Isolation + recipient-resolution edges (audit-tenancy F-4, F-6.2, F-6.4). Two tenants:
// A holds every task, B exists only to prove nothing reaches it. Recipients here are all
// people the guard must REFUSE, so each case's expected outcome is "the author gets it".
// ─────────────────────────────────────────────────────────────────────────────
suite("TSK-09: reminder sweep isolation + recipient refusal", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  const sweepA = () => remindDueTasks(db, { tenantId: id.tenantA, appBaseUrl: APP_URL, today, now });
  const taskRow = async (taskId: string) =>
    (await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId)))[0];
  const notificationsFor = (userId: string) =>
    db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await dropTenants(db, [SLUG_SCOPE, SLUG_SCOPE_B]);

    const [ta] = await db.insert(schema.tenants).values({ name: "TR Scope A", slug: SLUG_SCOPE }).returning({ id: schema.tenants.id });
    const [tb] = await db.insert(schema.tenants).values({ name: "TR Scope B", slug: SLUG_SCOPE_B }).returning({ id: schema.tenants.id });
    id.tenantA = ta.id;
    id.tenantB = tb.id;

    const [px] = await db.insert(schema.partners).values({ tenantId: ta.id, refId: "JV-001", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: ta.id, refId: "JV-002", name: "PY", color: "#222222", status: "active" }).returning({ id: schema.partners.id });
    const [pb] = await db.insert(schema.partners).values({ tenantId: tb.id, refId: "JV-001", name: "PB", color: "#333333", status: "active" }).returning({ id: schema.partners.id });

    id.adminA = randomUUID();
    id.pxUser = randomUUID();
    id.pyUser = randomUUID();
    // Phase C: the old fixture here (role=partner, partner_id NULL) is now IMPOSSIBLE at
    // write time (SCP-08 CHECK, migration 0054). The equivalent unresolvable recipient is a
    // MEMBER assigned to a PARTNER-stream task: the staff arm of taskWhere only reads the
    // admin stream, so they cannot see it and the sweep must skip them, not throw.
    id.orphanUser = randomUUID();
    id.adminB = randomUUID();
    await db.insert(schema.users).values([
      { id: id.adminA, tenantId: ta.id, email: "admin@tr-scope.test", role: "admin" as const },
      { id: id.pxUser, tenantId: ta.id, email: "px@tr-scope.test", role: "partner" as const, partnerId: px.id },
      { id: id.pyUser, tenantId: ta.id, email: "py@tr-scope.test", role: "partner" as const, partnerId: py.id },
      { id: id.orphanUser, tenantId: ta.id, email: "orphan@tr-scope.test", role: "member" as const, partnerId: null },
      { id: id.adminB, tenantId: tb.id, email: "admin@tr-scope-b.test", role: "admin" as const },
    ]);

    const [upA] = await db.insert(schema.uploads).values({ tenantId: ta.id, refId: "IM-26-310", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [upB] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "IM-26-311", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [leadA] = await db
      .insert(schema.leads)
      .values({ tenantId: ta.id, refId: "LD-26-30201", uploadId: upA.id, dedupeKey: "sa|1", rawJson: {}, partnerId: px.id, city: "Boise", state: "ID", matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    const [leadB] = await db
      .insert(schema.leads)
      .values({ tenantId: tb.id, refId: "LD-26-30301", uploadId: upB.id, dedupeKey: "sb|1", rawJson: {}, partnerId: pb.id, city: "Fargo", state: "ND", matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    id.leadA = leadA.id;
    await releaseTenantLeads(db, ta.id);
    await releaseTenantLeads(db, tb.id);

    const inserted = await db
      .insert(schema.leadTasks)
      .values([
        // Assignee lives in ANOTHER TENANT entirely (the FK permits it — no tenant constraint).
        { tenantId: ta.id, leadId: leadA.id, title: "Cross-tenant assignee", authorRole: "admin", authorUserId: id.adminA, assignedToUserId: id.adminB, dueOn: YESTERDAY },
        // Assignee is a partner user of ANOTHER ORG in the same tenant.
        { tenantId: ta.id, leadId: leadA.id, title: "Cross-org assignee", authorRole: "partner", authorUserId: id.pxUser, assignedToUserId: id.pyUser, dueOn: YESTERDAY },
        // Assignee is a partner-role user with no org — unscopeable, must fail closed.
        { tenantId: ta.id, leadId: leadA.id, title: "Orphan assignee", authorRole: "partner", authorUserId: id.pxUser, assignedToUserId: id.orphanUser, dueOn: YESTERDAY },
        // Tenant B's own due task: tenant A's sweep must not see, stamp, or mail it.
        { tenantId: tb.id, leadId: leadB.id, title: "Tenant B task", authorRole: "admin", authorUserId: id.adminB, assignedToUserId: id.adminB, dueOn: YESTERDAY },
      ])
      .returning({ id: schema.leadTasks.id, title: schema.leadTasks.title });
    for (const row of inserted) id[`task:${row.title}`] = row.id;
  });

  afterAll(async () => {
    await dropTenants(db, [SLUG_SCOPE, SLUG_SCOPE_B]);
    await client.end();
  });

  it("TSK-09/TST-01: tenant A's sweep never stamps, notifies, or emails tenant B", async () => {
    // Three of A's tasks are nudged (each via its author); B's is untouched.
    expect((await sweepA()).reminded).toBe(3);

    expect((await taskRow(id["task:Tenant B task"])).remindedAt).toBeNull();
    const bNotifs = await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, id.tenantB));
    expect(bNotifs).toHaveLength(0);
    const bEmails = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, id.tenantB));
    expect(bEmails).toHaveLength(0);
    // …and nothing addressed to B's user was written into A's outbox either.
    const aEmails = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, id.tenantA));
    expect(aEmails.some((e) => e.toAddress === "admin@tr-scope-b.test")).toBe(false);
  });

  it("TSK-09: a cross-tenant assigned_to_user_id falls back to the author, never delivers", async () => {
    expect(await notificationsFor(id.adminB)).toHaveLength(0);
    const author = await notificationsFor(id.adminA);
    expect(author.filter((n) => n.title === "Task due: Cross-tenant assignee")).toHaveLength(1);
    expect((await taskRow(id["task:Cross-tenant assignee"])).remindedAt).not.toBeNull();
  });

  it("TSK-09: a cross-org assignee is refused and the authoring org's author is nudged instead", async () => {
    // PY can read neither PX's tasks nor a lead PX owns — two independent reasons to refuse.
    expect((await notificationsFor(id.pyUser)).some((n) => n.title === "Task due: Cross-org assignee")).toBe(false);
    expect((await notificationsFor(id.pxUser)).filter((n) => n.title === "Task due: Cross-org assignee")).toHaveLength(1);
  });

  it("TSK-09: an assignee who cannot SEE the task (member on a partner-stream task) is skipped, not thrown on", async () => {
    // The fail-closed branch, Phase C shape: a member assignee on a partner-stream task is
    // refused by taskVisibleTo (staff arm reads only the admin stream), so the sweep skips
    // them and nudges the author instead. (The pre-0054 fixture — a partner row with no
    // partner_id — is now impossible via the SCP-08 CHECK; resolveRecipient keeps that
    // guard as defense-in-depth.)
    expect(await notificationsFor(id.orphanUser)).toHaveLength(0);
    expect((await notificationsFor(id.pxUser)).filter((n) => n.title === "Task due: Orphan assignee")).toHaveLength(1);
    expect((await taskRow(id["task:Orphan assignee"])).remindedAt).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sweep mechanics: the batch limit (pr F-1), transaction atomicity (tenancy F-6.5), and the
// consume-without-notify decision (pr F-2). Own tenant — the prefs case rewrites settings.
// ─────────────────────────────────────────────────────────────────────────────
suite("TSK-08: sweep mechanics — limit, atomicity, silent consume", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  const sweep = (limit?: number) =>
    remindDueTasks(db, { tenantId: id.tenant, appBaseUrl: APP_URL, today, now, ...(limit ? { limit } : {}) });
  const tasksNamed = async (prefix: string) =>
    (await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.tenantId, id.tenant))).filter((t) =>
      t.title.startsWith(prefix),
    );
  const emails = () => db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, id.tenant));

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await dropTenants(db, [SLUG_MECH]);

    const [t] = await db.insert(schema.tenants).values({ name: "TR Mechanics", slug: SLUG_MECH }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    id.admin = randomUUID();
    await db.insert(schema.users).values({ id: id.admin, tenantId: t.id, email: "admin@tr-mech.test", role: "admin" });
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-320", filename: "m.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [lead] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-30401", uploadId: up.id, dedupeKey: "mm|1", rawJson: {}, partnerId: px.id, city: "Ogden", state: "UT", matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    id.lead = lead.id;
    await releaseTenantLeads(db, id.tenant);
  });

  afterAll(async () => {
    await dropTenants(db, [SLUG_MECH]);
    await client.end();
  });

  const addTask = async (title: string) => {
    const [row] = await db
      .insert(schema.leadTasks)
      .values({ tenantId: id.tenant, leadId: id.lead, title, authorRole: "admin", authorUserId: id.admin, assignedToUserId: id.admin, dueOn: YESTERDAY })
      .returning({ id: schema.leadTasks.id });
    return row.id;
  };

  it("TSK-08: the batch limit caps one sweep and the remainder is picked up next run", async () => {
    await addTask("Limit 1");
    await addTask("Limit 2");
    await addTask("Limit 3");

    expect((await sweep(2)).reminded).toBe(2);
    let rows = await tasksNamed("Limit ");
    expect(rows.filter((r) => r.remindedAt !== null)).toHaveLength(2);
    expect(rows.filter((r) => r.remindedAt === null)).toHaveLength(1);

    // The straggler is not lost — the next tick claims it, and a third finds nothing.
    expect((await sweep(2)).reminded).toBe(1);
    rows = await tasksNamed("Limit ");
    expect(rows.every((r) => r.remindedAt !== null)).toBe(true);
    expect((await sweep(2)).reminded).toBe(0);
  });

  it("TSK-08: a failed notification rolls the stamp back — reminded_at stays NULL", async () => {
    const taskId = await addTask("Atomic");
    const emailsBefore = (await emails()).length;
    mockState.failNotifications = true;
    try {
      expect((await sweep()).reminded).toBe(0);
    } finally {
      mockState.failNotifications = false;
    }
    // Nothing was consumed and nothing was queued: stamp + notification + enqueue are one unit.
    const [row] = await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(row.remindedAt).toBeNull();
    expect(await emails()).toHaveLength(emailsBefore);

    // …and once the failure clears, the very same task is nudged normally.
    expect((await sweep()).reminded).toBe(1);
    expect((await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId)))[0].remindedAt).not.toBeNull();
  });

  it("TSK-08: both channels off still stamps reminded_at exactly once", async () => {
    await saveNotificationPrefs(db, { tenantId: id.tenant, role: "admin", userId: id.admin }, {
      admin: { task_due: { email: false, inApp: false } },
    });
    const taskId = await addTask("Silent");
    const emailsBefore = (await emails()).length;
    const notifsBefore = (await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, id.tenant))).length;

    // Consumed, deliberately: the nudge decision was made and spent, so the task cannot
    // accumulate in the overdue set forever waiting for a channel that is switched off.
    expect((await sweep()).reminded).toBe(1);
    expect((await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId)))[0].remindedAt).not.toBeNull();
    expect(await emails()).toHaveLength(emailsBefore);
    expect(await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, id.tenant))).toHaveLength(notifsBefore);
    expect((await sweep()).reminded).toBe(0);
  });
});

// C-14 / WP-TSK-6a: an orphaned reminder (no eligible recipient) is retired after N ticks and
// surfaced to an admin instead of re-probed forever; a wall-clock budget bounds the sweep.
suite("WP-TSK-6a (C-14): orphan retirement + wall-clock budget", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};
  const SLUG_C14 = "test-task-reminders-c14";
  const sweepC14 = (extra: Partial<Parameters<typeof remindDueTasks>[1]> = {}) =>
    remindDueTasks(db, { tenantId: id.tenant, appBaseUrl: APP_URL, today, now, ...extra });
  const taskRow = async (taskId: string) => (await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId)))[0];
  const orphanNotifs = () =>
    db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, id.admin), eq(schema.notifications.type, "task_reminder_orphaned")));

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await dropTenants(db, [SLUG_C14]);
    const [t] = await db.insert(schema.tenants).values({ name: "TR C14", slug: SLUG_C14 }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222222", status: "active" }).returning({ id: schema.partners.id });
    id.admin = randomUUID();
    id.pyUser = randomUUID();
    await db.insert(schema.users).values([
      { id: id.admin, tenantId: t.id, email: "admin@tr-c14.test", role: "admin" as const },
      { id: id.pyUser, tenantId: t.id, email: "py@tr-c14.test", role: "partner" as const, partnerId: py.id },
    ]);
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-c14", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [lead] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-C1401", uploadId: up.id, dedupeKey: "c14|1", rawJson: {}, partnerId: px.id, city: "Boise", state: "ID", matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    await releaseTenantLeads(db, t.id);
    // True orphan: authored AND assigned to PY, an org that does NOT own the lead (owned by PX) —
    // so neither the assignee nor the author can read it via taskWhere. Nobody to nudge.
    const [orphan] = await db
      .insert(schema.leadTasks)
      .values({ tenantId: t.id, leadId: lead.id, title: "Orphaned task", authorRole: "partner", authorUserId: id.pyUser, assignedToUserId: id.pyUser, dueOn: YESTERDAY })
      .returning({ id: schema.leadTasks.id });
    id.orphan = orphan.id;
    // A deliverable admin task (admin sees all admin-stream tasks) — for the budget test.
    const [ok] = await db
      .insert(schema.leadTasks)
      .values({ tenantId: t.id, leadId: lead.id, title: "Deliverable task", authorRole: "admin", authorUserId: id.admin, assignedToUserId: id.admin, dueOn: YESTERDAY })
      .returning({ id: schema.leadTasks.id });
    id.deliverable = ok.id;
  });

  afterAll(async () => {
    await dropTenants(db, [SLUG_C14]);
    await client.end();
  });

  it("C-14: an orphan increments per tick, retires at MAX + surfaces exactly ONE admin heads-up; never re-probed after", async () => {
    // One real tick: the counter ticks up, nothing is delivered, nothing retired yet.
    expect((await sweepC14()).retired).toBe(0);
    let orphan = await taskRow(id.orphan);
    expect(orphan.remindedAt).toBeNull(); // never delivered → never stamped
    expect(orphan.reminderAttempts).toBe(1); // one attempt per tick
    // Fast-forward to the brink (avoid MAX slow round-trips against the remote pooler), then one
    // more tick tips it over → retired + admin heads-up.
    await db.update(schema.leadTasks).set({ reminderAttempts: REMINDER_ATTEMPTS_MAX - 1 }).where(eq(schema.leadTasks.id, id.orphan));
    expect((await sweepC14()).retired).toBe(1); // retired on the tick that reaches MAX
    orphan = await taskRow(id.orphan);
    expect(orphan.reminderAttempts).toBe(REMINDER_ATTEMPTS_MAX);
    expect(orphan.remindedAt).toBeNull();
    const notifs = await orphanNotifs();
    expect(notifs).toHaveLength(1); // exactly one admin heads-up
    expect(notifs[0].title).toBe("A task reminder couldn't be delivered"); // generic — no task-title PII
    expect(notifs[0].title).not.toContain("Orphaned task");
    expect(notifs[0].leadRef).toBe("LD-26-C1401"); // correlated to the lead (C-13 redaction)
    // Retired: excluded from the sweep now — attempts stays at MAX, no second heads-up.
    expect((await sweepC14()).retired).toBe(0);
    expect((await taskRow(id.orphan)).reminderAttempts).toBe(REMINDER_ATTEMPTS_MAX);
    expect(await orphanNotifs()).toHaveLength(1);
  }, 60_000);

  it("C-14: the wall-clock budget stops the sweep — a passed deadline claims nothing", async () => {
    await db.update(schema.leadTasks).set({ remindedAt: null }).where(eq(schema.leadTasks.id, id.deliverable));
    // deadline already elapsed (clock returns a time after it) → the loop breaks before task 1.
    const r = await sweepC14({ deadlineMs: 1_000, clockMs: () => 2_000 });
    expect(r.reminded).toBe(0);
    expect((await taskRow(id.deliverable)).remindedAt).toBeNull(); // not processed
    // Sanity: with no budget the same task IS nudged, so the 0 above was the budget, not an empty set.
    expect((await sweepC14()).reminded).toBeGreaterThanOrEqual(1);
  }, 45_000);
});
