import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { purgeAuditLog } from "../helpers/audit";
import { releaseTenantLeads } from "../helpers/hold";
import { addLeadTask, editLeadTask } from "@/modules/tasks/tasks";
import { addLeadNote } from "@/modules/notes/notes";
import {
  notifyImportFailed,
  notifyImportProcessed,
  notifyPartnerActivated,
  notifyTaskAssigned,
} from "@/modules/notify/events";
import { saveSubjectOverride } from "@/modules/notify/pref-overrides";
import { jsonRequest, scopeContextMock, setRouteScope } from "./_route-harness";

// ─────────────────────────────────────────────────────────────────────────────
// WP-NF2 PR B — the four new notification types (NTF-11), proved live.
//
// This suite is almost entirely TST-01c recipient-set work, because that is where every
// interesting way to get a notification wrong lives: telling the wrong tenant, the wrong
// stream, a closed seat, the person who just performed the action, or telling somebody
// twice. Plus the two payload rules that are BINDING for these types (NTF-16): a task
// title never leaves the task, and a note body never leaves its stream.
//
// Self-skips without DATABASE_URL, like the rest of the tier.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/scope-context", async (importOriginal) => scopeContextMock(await importOriginal()));

/**
 * Detection stub for the ROUTE-level failure legs (pr-reviewer F-2). The uploads route decides
 * two of its three failure classes from `detectProfile(headers, loadProfilesForDetection(...))`,
 * so controlling the profile list is what makes `missing_required` reachable without seeding a
 * format; `throwNext` reaches the `process_failed` catch, which is otherwise only entered by a
 * genuine defect. `vi.hoisted` because vi.mock is hoisted above the imports.
 *
 * Default `{ profiles: [] }` reproduces a tenant with no saved formats, which is what the
 * `unrecognized` leg wants — and reproduces it deterministically, rather than depending on none
 * of the built-in SEED profiles happening to match the fixture's headers.
 */
const detection = vi.hoisted(() => ({ profiles: [] as unknown[], throwNext: false }));
vi.mock("@/modules/sources/profile-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/sources/profile-store")>();
  return {
    ...actual,
    loadProfilesForDetection: async () => {
      if (detection.throwNext) throw new Error("detection store unavailable");
      return detection.profiles;
    },
  };
});

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

// Slugs are UNIQUE PER RUN (the `test-scp03-alpha-*` precedent). `cleanup()` resolves tenants
// BY SLUG and then deletes their users, so a fixed slug lets two runs against the same test
// project delete each other's rows mid-flight. The suffix scopes both setup and cleanup to
// this process's own tenants.
const RUN = randomUUID().slice(0, 8);
const SLUG = `test-nf2-new-types-${RUN}`;
const SLUG_B = `test-nf2-new-types-b-${RUN}`;
const REF_X = "LD-26-40001";
const TASK_TITLE = "Call Marjorie Blenkinsop on 555-0134";
const NOTE_BODY = "Seller says call back after 4pm on 555-0134";

suite("WP-NF2 NTF-11: four new notification types", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG, SLUG_B]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    // tos_acceptances has no tenant_id (it is keyed by user), so it is cleared by user id.
    const users = await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.tenantId, tids));
    if (users.length > 0) {
      await db.delete(schema.tosAcceptances).where(inArray(schema.tosAcceptances.userId, users.map((u) => u.id)));
    }
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    for (const tbl of [
      schema.notifications,
      schema.emailOutbox,
      schema.notificationPrefOverrides,
      schema.settings,
      schema.leadNotes,
      schema.leadTasks,
      schema.leads,
      schema.uploads,
      schema.users,
      schema.partners,
    ]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();

    const [t] = await db.insert(schema.tenants).values({ name: "NF2 Types", slug: SLUG }).returning({ id: schema.tenants.id });
    const [tb] = await db.insert(schema.tenants).values({ name: "NF2 Types B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    id.tenantB = tb.id;

    // PX is an ACTIVE partner (owns the lead the task/note tests work on); PZ is still
    // INVITED, so it is the one that can transition for partner_activated.
    const [px] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111111", status: "active" })
      .returning({ id: schema.partners.id });
    const [pz] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "JV-003", name: "Zephyr Realty", color: "#333333", status: "invited" })
      .returning({ id: schema.partners.id });
    // PV is ALREADY active — the re-accept no-op leg owns it, so that test asserts a property
    // of the route rather than depending on a sibling test having run first (audit-tenancy F-8).
    const [pv] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "JV-004", name: "Vantage Homes", color: "#444444", status: "active" })
      .returning({ id: schema.partners.id });
    // PW stays invited for the whole suite: it is the target of the CROSS-TENANT promotion
    // probe, which must leave it untouched.
    const [pw] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "JV-005", name: "Westbrook Group", color: "#555555", status: "invited" })
      .returning({ id: schema.partners.id });
    id.px = px.id;
    id.pz = pz.id;
    id.pv = pv.id;
    id.pw = pw.id;

    for (const k of ["adminA", "adminB", "adminGone", "memberA", "viewerA", "pxUser", "pxUser2", "pzUser", "pvUser", "adminOther"]) {
      id[k] = randomUUID();
    }
    // created_at is pinned so `activeAdminSeats`' deterministic order (and therefore the
    // shared-mailbox dedupe) is assertable rather than planner-dependent.
    await db.insert(schema.users).values([
      { id: id.adminA, tenantId: t.id, email: "admina@nf2.test", role: "admin" as const, createdAt: new Date("2026-01-01T00:00:00.000Z") },
      { id: id.adminB, tenantId: t.id, email: "adminb@nf2.test", role: "admin" as const, createdAt: new Date("2026-01-02T00:00:00.000Z") },
      {
        id: id.adminGone, tenantId: t.id, email: "gone@nf2.test", role: "admin" as const,
        createdAt: new Date("2026-01-03T00:00:00.000Z"), deactivatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      { id: id.memberA, tenantId: t.id, email: "member@nf2.test", role: "member" as const, createdAt: new Date("2026-01-04T00:00:00.000Z") },
      { id: id.viewerA, tenantId: t.id, email: "viewer@nf2.test", role: "viewer" as const, createdAt: new Date("2026-01-05T00:00:00.000Z") },
      { id: id.pxUser, tenantId: t.id, email: "px@nf2.test", role: "partner" as const, partnerId: px.id, createdAt: new Date("2026-01-06T00:00:00.000Z") },
      { id: id.pxUser2, tenantId: t.id, email: "px2@nf2.test", role: "partner" as const, partnerId: px.id, createdAt: new Date("2026-01-07T00:00:00.000Z") },
      { id: id.pzUser, tenantId: t.id, email: "pz@nf2.test", role: "partner" as const, partnerId: pz.id, createdAt: new Date("2026-01-08T00:00:00.000Z") },
      { id: id.pvUser, tenantId: t.id, email: "pv@nf2.test", role: "partner" as const, partnerId: pv.id, createdAt: new Date("2026-01-09T00:00:00.000Z") },
      // Tenant B's admin: the cross-tenant probe. Every emit below must leave them alone.
      { id: id.adminOther, tenantId: tb.id, email: "admin@nf2-b.test", role: "admin" as const },
    ]);

    const [up] = await db
      .insert(schema.uploads)
      .values({ tenantId: t.id, refId: "IM-26-401", filename: "a.xlsx", status: "processed" })
      .returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({
      tenantId: t.id, refId: REF_X, uploadId: up.id, dedupeKey: "nf2|1", rawJson: {},
      partnerId: px.id, matchMethod: "zip", mlsStatus: "kept",
    });
    // Past the distribution hold, so the partner stream can work the lead.
    await releaseTenantLeads(db, id.tenant);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  beforeEach(async () => {
    setRouteScope(null);
    detection.profiles = [];
    detection.throwNext = false;
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, [id.tenant, id.tenantB]));
    await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.tenantId, [id.tenant, id.tenantB]));
    await db.delete(schema.notificationPrefOverrides).where(eq(schema.notificationPrefOverrides.tenantId, id.tenant));
    await db.delete(schema.settings).where(eq(schema.settings.tenantId, id.tenant));
  });

  const adminA = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminA });
  /** WP-NF2b: email legs default OFF and there is no workspace matrix to flip, so a leg that
   *  needs to be ON for a test is turned on where it now lives — the RECIPIENT seat's own
   *  overlay. Naming the recipient explicitly is also the sharper test: it proves the emit
   *  resolved the person it addressed, not some tenant-wide switch. */
  const seatEmailOn = (userId: string, event: string) =>
    saveSubjectOverride(db, id.tenant, { userId }, { events: { [event]: { email: true, inApp: true } } });
  const partnerX = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });

  /** Every notification row in BOTH tenants — so a cross-tenant leak shows up as an extra row
   *  rather than as an assertion nobody wrote. */
  const allNotifications = () =>
    db
      .select()
      .from(schema.notifications)
      .where(inArray(schema.notifications.tenantId, [id.tenant, id.tenantB]));
  const notificationsOfType = async (type: string) => (await allNotifications()).filter((n) => n.type === type);
  const allEmails = () =>
    db.select().from(schema.emailOutbox).where(inArray(schema.emailOutbox.tenantId, [id.tenant, id.tenantB]));
  const recipients = async (type: string) => (await notificationsOfType(type)).map((n) => n.userId).sort();

  // ── task_assigned ──────────────────────────────────────────────────────────

  it("TST-01c: task_assigned goes to the assignee SEAT only — not the actor, not colleagues", async () => {
    await addLeadTask(adminA(), REF_X, { title: TASK_TITLE, assignedToUserId: id.adminB });
    const rows = await notificationsOfType("task_assigned");
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(id.adminB);
    expect(rows[0].tenantId).toBe(id.tenant);
    expect(rows[0].title).toBe(`You were assigned a task on lead ${REF_X}`);
    // An admin-stream assignee gets the admin app's dialog link (not the portal's).
    expect(rows[0].deepLink).toBe(`/leads?open=${REF_X}`);
    expect(rows[0].leadRef).toBe(REF_X); // C-13: correlated for void/purge redaction
    // Nobody else — including the actor, the other tiers, and the other tenant's admin.
    expect(rows.map((r) => r.userId)).not.toContain(id.adminA);
    expect(rows.map((r) => r.userId)).not.toContain(id.adminOther);
  });

  it("NTF-16/SEC-05: the task TITLE never appears in the notification or the email", async () => {
    await seatEmailOn(id.adminB, "task_assigned");
    await addLeadTask(adminA(), REF_X, { title: TASK_TITLE, assignedToUserId: id.adminB });
    const [row] = await notificationsOfType("task_assigned");
    const [mail] = await allEmails();
    // A task title is free text typed on a lead — it can carry the seller's name and phone
    // number (this fixture's does). Assert on the whole payload, not just the title field.
    const payload = JSON.stringify(row) + JSON.stringify(mail);
    expect(payload).not.toContain("Marjorie");
    expect(payload).not.toContain("555-0134");
    expect(row.body).toBe("A task on this lead is now assigned to you.");
  });

  it("TST-01c: assigning a task to YOURSELF notifies nobody", async () => {
    await addLeadTask(adminA(), REF_X, { title: "Mine", assignedToUserId: id.adminA });
    expect(await notificationsOfType("task_assigned")).toHaveLength(0);
    // …and so does the default (TSK-03 falls back to the creator when no assignee is given).
    await addLeadTask(adminA(), REF_X, { title: "Also mine" });
    expect(await notificationsOfType("task_assigned")).toHaveLength(0);
  });

  it("TST-01c: re-saving the SAME assignee is a no-op; a NEW assignee notifies once", async () => {
    const { id: taskId } = await addLeadTask(adminA(), REF_X, { title: "Follow up", assignedToUserId: id.adminB });
    expect(await notificationsOfType("task_assigned")).toHaveLength(1);

    // Same assignee again — the assignment did not change, so there is nothing to announce.
    await db.delete(schema.notifications).where(eq(schema.notifications.tenantId, id.tenant));
    await editLeadTask(adminA(), taskId, { assignedToUserId: id.adminB });
    expect(await notificationsOfType("task_assigned")).toHaveLength(0);

    // A title-only edit likewise touches no assignment.
    await editLeadTask(adminA(), taskId, { title: "Follow up twice" });
    expect(await notificationsOfType("task_assigned")).toHaveLength(0);

    // Handing it to someone new does announce — and a MEMBER seat is a valid assignee (the
    // admin-TIER restriction applies to the three OPS types, never to task_assigned).
    await editLeadTask(adminA(), taskId, { assignedToUserId: id.memberA });
    expect(await recipients("task_assigned")).toEqual([id.memberA]);
  });

  it("TST-01c/PRN-13: a PARTNER assignee gets the portal link and their own stream's row", async () => {
    await addLeadTask(partnerX(), REF_X, { title: TASK_TITLE, assignedToUserId: id.pxUser2 });
    const rows = await notificationsOfType("task_assigned");
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(id.pxUser2);
    // The ASSIGNEE's stream decides the app — a partner is never sent into the admin routes.
    expect(rows[0].deepLink).toBe(`/portal/leads/${REF_X}`);
    // No admin hears about a partner's internal task assignment (PRN-13).
    expect(rows.map((r) => r.userId)).not.toContain(id.adminA);
  });

  it("NTF-10: an overlay with email off suppresses the email but KEEPS the bell row", async () => {
    // The recipient has opted their own email leg IN (§10.1's default is email-off).
    await seatEmailOn(id.adminB, "task_assigned");
    await addLeadTask(adminA(), REF_X, { title: "Emailed", assignedToUserId: id.adminB });
    let mails = await allEmails();
    expect(mails).toHaveLength(1);
    expect(mails[0].toAddress).toBe("adminb@nf2.test");
    expect(mails[0].kind).toBe("task_assigned");
    // NTF-14: every notification email carries this recipient's own unsubscribe footer.
    expect(mails[0].html).toContain("/unsubscribe?token=");
    expect(mails[0].html).toContain("Stop all notification emails");

    // Now the seat mutes only their EMAIL leg. The bell must survive — unsubscribing from
    // email must never silently blind someone's notification centre (§10.7).
    await db.delete(schema.notifications).where(eq(schema.notifications.tenantId, id.tenant));
    await db.delete(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, id.tenant));
    await saveSubjectOverride(db, id.tenant, { userId: id.adminB }, { events: { task_assigned: { email: false } } });
    await addLeadTask(adminA(), REF_X, { title: "Bell only", assignedToUserId: id.adminB });
    mails = await allEmails();
    expect(mails).toHaveLength(0);
    expect(await recipients("task_assigned")).toEqual([id.adminB]);
  });

  it("NTF-10: another seat's overlay never gates this one's (per-subject, not per-tenant)", async () => {
    await seatEmailOn(id.adminB, "task_assigned");
    // adminA mutes everything for themselves; the notification is addressed to adminB.
    await saveSubjectOverride(db, id.tenant, { userId: id.adminA }, { allEmailsOff: true });
    await addLeadTask(adminA(), REF_X, { title: "Still sends", assignedToUserId: id.adminB });
    expect(await allEmails()).toHaveLength(1);
    expect(await recipients("task_assigned")).toEqual([id.adminB]);
  });

  // ── notifyTaskAssigned's OWN pins (audit-tenancy F-2) ──────────────────────
  //
  // Every leg above reaches this emit through addLeadTask/editLeadTask, which means it reaches
  // it through `resolveAssignee` — and resolveAssignee already refuses a foreign-tenant seat, a
  // cross-stream seat and a deactivated seat. So the function's OWN tenant and active-seat pins
  // can never be exercised from a caller: delete them and every test above still passes. These
  // three call it DIRECTLY, which is the only way to prove the pins do something, and the third
  // is the non-vacuity control — without it, a function that returned early on every input
  // would satisfy the first two.

  it("TST-01c: notifyTaskAssigned ignores a seat from ANOTHER tenant (direct call)", async () => {
    // adminOther lives in tenant B. `users.id` is globally unique, so without the tenant pin
    // this read would find them and write a row into tenant A addressed to a stranger.
    await notifyTaskAssigned(db, id.tenant, { leadRef: REF_X, assigneeUserId: id.adminOther });
    expect(await allNotifications()).toHaveLength(0);
    expect(await allEmails()).toHaveLength(0);
  });

  it("TST-01c: notifyTaskAssigned ignores a DEACTIVATED seat (direct call)", async () => {
    // A closed seat is refused a session, so it is refused a notification (F-7). resolveAssignee
    // enforces this too (TSK-13) — this proves the recipient boundary states it independently.
    await notifyTaskAssigned(db, id.tenant, { leadRef: REF_X, assigneeUserId: id.adminGone });
    expect(await allNotifications()).toHaveLength(0);
  });

  it("TST-01c: notifyTaskAssigned DOES fire for a live in-tenant seat (non-vacuity control)", async () => {
    await notifyTaskAssigned(db, id.tenant, { leadRef: REF_X, assigneeUserId: id.adminB });
    const rows = await notificationsOfType("task_assigned");
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(id.adminB);
  });

  // ── partner_note ───────────────────────────────────────────────────────────

  it("TST-01c: a PARTNER note notifies every ACTIVE admin-TIER seat, and nobody else", async () => {
    await addLeadNote(partnerX(), REF_X, NOTE_BODY);
    const rows = await notificationsOfType("partner_note");
    expect(rows.map((r) => r.userId).sort()).toEqual([id.adminA, id.adminB].sort());
    // §10.4: member/viewer are lead workers, not pipeline operators — excluded by design.
    // A deactivated admin is refused a session, so it is refused a notification (F-7).
    // The authoring partner is never told about their own note, and the other tenant's
    // admin hears nothing at all.
    for (const excluded of [id.memberA, id.viewerA, id.adminGone, id.pxUser, id.adminOther]) {
      expect(rows.map((r) => r.userId)).not.toContain(excluded);
    }
    expect(rows[0].title).toBe(`New partner note on lead ${REF_X}`);
    expect(rows[0].deepLink).toBe(`/leads?open=${REF_X}`);
    expect(rows[0].leadRef).toBe(REF_X);
  });

  it("PRN-13: an ADMIN note emits NOTHING (the direction is one-way, by design)", async () => {
    await addLeadNote(adminA(), REF_X, "Internal: chase the title company");
    expect(await allNotifications()).toHaveLength(0);
    expect(await allEmails()).toHaveLength(0);
  });

  it("NTF-16/PRN-13: the note BODY never reaches the notification or the email", async () => {
    await seatEmailOn(id.adminA, "partner_note");
    await seatEmailOn(id.adminB, "partner_note");
    await addLeadNote(partnerX(), REF_X, NOTE_BODY);
    // Assert on the FULL payloads: the body must not be in a title, a body, a subject, an
    // html shell, or a meta blob — anywhere a careless refactor might tuck it.
    const payload = JSON.stringify(await allNotifications()) + JSON.stringify(await allEmails());
    expect(payload).not.toContain("call back after 4pm");
    expect(payload).not.toContain("555-0134");
    const [row] = await notificationsOfType("partner_note");
    expect(row.body).toBe("A partner added a note to this lead.");
  });

  // ── import_result ──────────────────────────────────────────────────────────

  it("TST-01c: import SUCCESS notifies every admin EXCEPT the acting one (§10.2)", async () => {
    await notifyImportProcessed(db, id.tenant, { uploadRef: "IM-26-401", actorUserId: id.adminA });
    const rows = await notificationsOfType("import_result");
    // The actor's signal is their run_summary — two rows about one upload in one bell is noise.
    expect(rows.map((r) => r.userId)).toEqual([id.adminB]);
    expect(rows[0].title).toBe("Import IM-26-401 processed");
    expect(rows[0].deepLink).toBe("/imports/IM-26-401");
    // An import spans many leads, so there is nothing single to redact by (C-13).
    expect(rows[0].leadRef).toBeNull();
  });

  it("TST-01c: import FAILURE notifies every admin INCLUDING the actor", async () => {
    await notifyImportFailed(db, id.tenant, { filename: "august-leads.xlsx", failure: "missing_required" });
    const rows = await notificationsOfType("import_result");
    expect(rows.map((r) => r.userId).sort()).toEqual([id.adminA, id.adminB].sort());
    for (const excluded of [id.memberA, id.viewerA, id.adminGone, id.pxUser, id.adminOther]) {
      expect(rows.map((r) => r.userId)).not.toContain(excluded);
    }
    // A filename is OPERATOR data (an admin named their own file), so it is allowed — and it
    // is the thing that makes the row actionable. The failure class rides along.
    expect(rows[0].title).toContain("august-leads.xlsx");
    expect(rows[0].title).toContain("required columns are missing");
    expect(rows[0].deepLink).toBe("/upload");
    expect(rows[0].leadRef).toBeNull();
  });

  it("ING-08: repeated failed attempts EACH notify (loud by design, §10.2)", async () => {
    await notifyImportFailed(db, id.tenant, { filename: "broken.xlsx", failure: "unrecognized" });
    await notifyImportFailed(db, id.tenant, { filename: "broken.xlsx", failure: "unrecognized" });
    // Two admins × two attempts. Deliberate: a quietly-swallowed second failure is exactly the
    // shape ING-08 exists to prevent. Owner-flagged as the one throttle-able behaviour here.
    expect(await notificationsOfType("import_result")).toHaveLength(4);
  });

  it("NTF-11: the uploads route emits the failure row on the ING-08 unrecognized branch", async () => {
    // The wiring test: this tenant has no source profiles, so detection cannot match and the
    // route takes its `unrecognized` branch — which now leaves a durable admin record behind
    // instead of only a toast that dies with the tab.
    const { POST } = await import("@/app/api/uploads/route");
    setRouteScope(adminA());
    const res = await POST(
      jsonRequest("POST", "/api/uploads", {
        filename: "mystery.xlsx",
        headers: ["Nothing", "We", "Know"],
        rows: [{ Nothing: "1" }],
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("unrecognized");
    const rows = await notificationsOfType("import_result");
    expect(rows.map((r) => r.userId).sort()).toEqual([id.adminA, id.adminB].sort());
    expect(rows[0].title).toContain("mystery.xlsx");
    expect(rows[0].title).toContain("format");
  });

  it("NTF-11/ING-08: the uploads route emits on the missing_required 422, and still answers 422", async () => {
    // The other pre-row ING-08 branch. A saved format whose REQUIRED column is absent and has
    // no candidate to remap onto is a hard block — and now also a durable admin record. The
    // assertion covers BOTH: the HTTP contract the upload screen depends on is unchanged, and
    // the notification is additional rather than instead.
    detection.profiles = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "NF2 Probe Format",
        version: 1,
        headerSignature: ["Alpha", "Beta", "Gamma", "Seller First"],
        mapping: { sellerFirst: "Seller First" },
        requiredColumns: ["sellerFirst"],
        strictness: "flexible",
      },
    ];
    const { POST } = await import("@/app/api/uploads/route");
    setRouteScope(adminA());
    const res = await POST(
      jsonRequest("POST", "/api/uploads", {
        filename: "no-seller-column.xlsx",
        headers: ["Alpha", "Beta", "Gamma"],
        rows: [{ Alpha: "1" }],
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("missing_required");
    expect(body.missingRequired).toContain("sellerFirst");

    const rows = await notificationsOfType("import_result");
    expect(rows.map((r) => r.userId).sort()).toEqual([id.adminA, id.adminB].sort());
    expect(rows[0].title).toContain("no-seller-column.xlsx");
    expect(rows[0].title).toContain("required columns are missing");
    expect(rows[0].deepLink).toBe("/upload");
  });

  it("NTF-11: the uploads route emits on the process_failed catch, and still answers 500", async () => {
    // The unexpected-failure leg — the one that used to leave no trace anywhere once the tab
    // was closed. Forced by making the detection load throw, which is the earliest thing inside
    // the route's try; any later throw takes the same catch.
    detection.throwNext = true;
    const { POST } = await import("@/app/api/uploads/route");
    setRouteScope(adminA());
    const res = await POST(
      jsonRequest("POST", "/api/uploads", {
        filename: "exploding.xlsx",
        headers: ["Anything"],
        rows: [{ Anything: "1" }],
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("process_failed");

    // Recipients INCLUDE the actor (§10.2) — nothing else is going to tell them.
    const rows = await notificationsOfType("import_result");
    expect(rows.map((r) => r.userId).sort()).toEqual([id.adminA, id.adminB].sort());
    expect(rows[0].title).toContain("exploding.xlsx");
    expect(rows[0].title).toContain("processing failed");
  });

  // ── partner_activated ──────────────────────────────────────────────────────

  it("TST-01c: accepting the ToS promotes invited → active and notifies the admins ONCE", async () => {
    const { POST } = await import("@/app/api/auth/tos/accept/route");
    setRouteScope({ tenantId: id.tenant, role: "partner", userId: id.pzUser, partnerId: id.pz });

    const res = await POST(jsonRequest("POST", "/api/auth/tos/accept", {}));
    expect(res.status).toBe(200);
    const [partner] = await db
      .select({ status: schema.partners.status, activatedAt: schema.partners.activatedAt })
      .from(schema.partners)
      .where(eq(schema.partners.id, id.pz));
    expect(partner.status).toBe("active");
    expect(partner.activatedAt).not.toBeNull();

    const rows = await notificationsOfType("partner_activated");
    expect(rows.map((r) => r.userId).sort()).toEqual([id.adminA, id.adminB].sort());
    // PRN-14: name AND ref id — identity is never carried by a colour swatch, and a name on
    // its own is not unique.
    expect(rows[0].title).toBe("Zephyr Realty (JV-003) accepted their invite");
    expect(rows[0].deepLink).toBe(`/partners/${id.pz}`);
    expect(rows[0].leadRef).toBeNull();
    for (const excluded of [id.memberA, id.viewerA, id.adminGone, id.pzUser, id.adminOther]) {
      expect(rows.map((r) => r.userId)).not.toContain(excluded);
    }
  });

  it("TST-01c: re-accepting is a NO-OP — the invite is only accepted once, ever", async () => {
    // SELF-CONTAINED (audit-tenancy F-8): this uses PV, seeded ALREADY ACTIVE, instead of
    // leaning on the previous test having promoted PZ. The pre-state is asserted here, so the
    // test states its own premise and cannot silently become vacuous if the file is reordered,
    // filtered to a single `it`, or if the promotion test starts failing.
    const [pre] = await db
      .select({ status: schema.partners.status })
      .from(schema.partners)
      .where(eq(schema.partners.id, id.pv));
    expect(pre.status).toBe("active");

    // Without the `.returning()` this PR added, the route could not tell a real transition from
    // a no-op, and every ToS re-acceptance would re-announce the partner to every admin forever.
    const { POST } = await import("@/app/api/auth/tos/accept/route");
    setRouteScope({ tenantId: id.tenant, role: "partner", userId: id.pvUser, partnerId: id.pv });
    const res = await POST(jsonRequest("POST", "/api/auth/tos/accept", {}));
    expect(res.status).toBe(200);
    expect(await notificationsOfType("partner_activated")).toHaveLength(0);
    // The ToS acceptance itself still recorded — the no-op is the PROMOTION, not the accept.
    const accepted = await db
      .select({ userId: schema.tosAcceptances.userId })
      .from(schema.tosAcceptances)
      .where(eq(schema.tosAcceptances.userId, id.pvUser));
    expect(accepted).toHaveLength(1);
  });

  it("TST-01c: a FORGED partner scope cannot promote another tenant's partner", async () => {
    // audit-tenancy F-1. The scope names tenant B but carries tenant A's invited partner id —
    // the shape a broken/hostile scope resolution would produce. `scope.partnerId` comes from
    // the session, but an id is not a scope: without the tenant predicate on the UPDATE, this
    // request activates a partner in a tenant the caller has nothing to do with and tells that
    // tenant's admins about it. (A production reachability probe found no scope that can
    // currently produce this pairing — which is exactly why it has to be pinned in the
    // statement rather than trusted to stay true of the data.)
    const { POST } = await import("@/app/api/auth/tos/accept/route");
    setRouteScope({ tenantId: id.tenantB, role: "partner", userId: id.adminOther, partnerId: id.pw });
    const res = await POST(jsonRequest("POST", "/api/auth/tos/accept", {}));
    expect(res.status).toBe(200); // the caller learns nothing from the status either

    const [pw] = await db
      .select({ status: schema.partners.status, activatedAt: schema.partners.activatedAt })
      .from(schema.partners)
      .where(eq(schema.partners.id, id.pw));
    expect(pw.status).toBe("invited"); // untouched
    expect(pw.activatedAt).toBeNull();
    expect(await allNotifications()).toHaveLength(0);
    expect(await allEmails()).toHaveLength(0);
  });

  it("TST-01c: notifyPartnerActivated resolves nothing for another tenant's partner id (direct call)", async () => {
    // audit-tenancy F-3. The emit's own tenant pin, exercised directly — the route can no
    // longer deliver a mismatched pair to it (the leg above), so this is the only way to prove
    // the pin still does something. A missing pin would leak the partner's NAME and REF ID into
    // a foreign tenant's notification titles.
    await notifyPartnerActivated(db, id.tenantB, { partnerId: id.px });
    expect(await allNotifications()).toHaveLength(0);

    // Non-vacuity control: the same call with the RIGHT tenant does fan out.
    await notifyPartnerActivated(db, id.tenant, { partnerId: id.px });
    const rows = await notificationsOfType("partner_activated");
    expect(rows.map((r) => r.userId).sort()).toEqual([id.adminA, id.adminB].sort());
    expect(rows[0].title).toBe("PX (JV-001) accepted their invite");
  });

  it("TST-01c: an ADMIN accepting the ToS never emits partner_activated", async () => {
    const { POST } = await import("@/app/api/auth/tos/accept/route");
    setRouteScope(adminA());
    const res = await POST(jsonRequest("POST", "/api/auth/tos/accept", {}));
    expect(res.status).toBe(200);
    expect(await allNotifications()).toHaveLength(0);
  });
});
