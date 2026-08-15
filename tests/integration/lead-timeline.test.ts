import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { releaseTenantLeads } from "../helpers/hold";
import type { ScopeContext } from "@/lib/scope";
import { getAdminLeadDetail } from "@/modules/leads/queries";
import { TIMELINE_STREAM_LIMIT } from "@/modules/leads/timeline";
import { getPartnerLeadDetail } from "@/modules/portal/queries";
import { addLeadNote } from "@/modules/notes/notes";
import { addLeadTask, completeLeadTask } from "@/modules/tasks/tasks";
import { updateLeadStatus } from "@/modules/portal/status-update";

// WP-TSK-3 / TSK-06 (live): the unified per-lead timeline read-model. The detail
// activity feed merges system events, status changes, notes and task events — newest
// first — and every contributed stream flows through its own scope builder, so the
// two-stream (PRN-13/ADR-0044) and re-route (R-22) boundaries hold on the timeline
// exactly as they do on the notes/tasks endpoints. Self-skips without DATABASE_URL.
// Run with node --env-file=.env.local.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-lead-timeline";
const SLUG_B = "test-lead-timeline-b";

// LD-26-30001 stays with partner X; LD-26-30002 is re-routed X → Y mid-suite.
const REF_MAIN = "LD-26-30001";
const REF_RR = "LD-26-30002";
const REF_DEL = "LD-26-30003"; // recalled (soft-deleted) mid-suite
const REF_HELD = "LD-26-30004"; // still inside the distribution-hold window
const REF_CAP = "LD-26-30005"; // the stream-cap fixture
const REF_B = "LD-26-30099"; // tenant B's lead

suite("TSK-06: unified lead timeline", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG, SLUG_B]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leadTasks).where(inArray(schema.leadTasks.tenantId, tids));
    await db.delete(schema.leadNotes).where(inArray(schema.leadNotes.tenantId, tids));
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();

    const [t] = await db.insert(schema.tenants).values({ name: "Lead Timeline", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "Yankee Homes", color: "#222", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.py = py.id;

    id.adminUser = randomUUID();
    id.pxUser = randomUUID();
    id.pyUser = randomUUID();
    await db.insert(schema.users).values([
      { id: id.adminUser, tenantId: t.id, email: "admin@timeline.test", role: "admin" as const },
      { id: id.pxUser, tenantId: t.id, email: "px@timeline.test", role: "partner" as const, partnerId: px.id },
      { id: id.pyUser, tenantId: t.id, email: "py@timeline.test", role: "partner" as const, partnerId: py.id },
    ]);

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-301", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    id.upload = up.id;
    await db.insert(schema.leads).values(
      [REF_MAIN, REF_RR, REF_DEL, REF_CAP].map((ref, i) => ({
        tenantId: t.id, refId: ref, uploadId: up.id, dedupeKey: `tl|${i}`, rawJson: {},
        partnerId: px.id, matchMethod: "zip" as const, mlsStatus: "kept" as const, campaign: "Campaign A",
      })),
    );
    await releaseTenantLeads(db, id.tenant);
    // …then a lead that is STILL HELD (fresh created_at, after the bulk release).
    await db.insert(schema.leads).values({
      tenantId: t.id, refId: REF_HELD, uploadId: up.id, dedupeKey: "tl|held", rawJson: {},
      partnerId: px.id, matchMethod: "zip", mlsStatus: "kept",
    });

    // ── Tenant B: a whole second workspace, with content on its own lead ──────
    const [tb] = await db.insert(schema.tenants).values({ name: "Lead Timeline B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantB = tb.id;
    const [pb] = await db.insert(schema.partners).values({ tenantId: tb.id, refId: "JV-001", name: "PB", color: "#333", status: "active" }).returning({ id: schema.partners.id });
    id.pb = pb.id;
    id.adminUserB = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUserB, tenantId: tb.id, email: "admin@timeline-b.test", role: "admin" });
    const [upB] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "IM-26-302", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({
      tenantId: tb.id, refId: REF_B, uploadId: upB.id, dedupeKey: "tb|1", rawJson: {},
      partnerId: pb.id, matchMethod: "zip", mlsStatus: "kept",
    });
    await releaseTenantLeads(db, id.tenantB);
    await addLeadNote(adminB(), REF_B, "TENANT-B-CONTENT note");
    await addLeadTask(adminB(), REF_B, { title: "TENANT-B-CONTENT task" });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const admin = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminUser });
  const partnerX = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });
  const partnerY = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pyUser, partnerId: id.py });
  const adminB = (): ScopeContext => ({ tenantId: id.tenantB, role: "admin", userId: id.adminUserB });

  const leadIdOf = async (ref: string, tenantId: string) => {
    const [lead] = await db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), eq(schema.leads.refId, ref)));
    return lead.id;
  };

  it("TSK-06: admin timeline merges system events + status + admin notes + task events newest-first", async () => {
    await addLeadNote(admin(), REF_MAIN, "ADMIN-ONLY timeline note");
    const { id: adminTask } = await addLeadTask(admin(), REF_MAIN, { title: "ADMIN-ONLY call the seller" });
    await completeLeadTask(admin(), adminTask);
    await updateLeadStatus(admin(), REF_MAIN, "Contacted");
    // The partner stream writes on the same lead — none of it may surface admin-side.
    await addLeadNote(partnerX(), REF_MAIN, "PARTNER-ONLY timeline note");
    await addLeadTask(partnerX(), REF_MAIN, { title: "PARTNER-ONLY knock on the door" });

    const detail = await getAdminLeadDetail(admin(), REF_MAIN);
    expect(detail).toBeTruthy();
    const activity = detail!.activity;

    // Every stream is represented, and the pre-existing system events are untouched.
    const kinds = activity.map((a) => a.kind);
    expect(kinds).toContain("imported");
    expect(kinds).toContain("routed");
    expect(kinds).toContain("status");
    expect(kinds).toContain("note");
    expect(kinds).toContain("task_created");
    expect(kinds).toContain("task_completed");

    // Newest first, one array (no parallel structure).
    const ats = activity.map((a) => a.at);
    expect([...ats].sort((a, b) => b.localeCompare(a))).toEqual(ats);

    // The note body rides along (the timeline renders it); the task carries its title.
    const note = activity.find((a) => a.kind === "note");
    expect(note!.body).toBe("ADMIN-ONLY timeline note");
    expect(note!.actor).toBe("admin@timeline.test");
    expect(activity.find((a) => a.kind === "task_created")!.title).toBe("ADMIN-ONLY call the seller");

    // PRN-13: not one byte of the partner stream reaches the admin timeline.
    expect(JSON.stringify(activity)).not.toContain("PARTNER-ONLY");
  });

  it("TSK-06: partner timeline shows only own-org notes/tasks (PRN-13)", async () => {
    const detail = await getPartnerLeadDetail(partnerX(), REF_MAIN);
    expect(detail).toBeTruthy();
    const activity = detail!.activity;

    const payload = JSON.stringify(activity);
    expect(payload).toContain("PARTNER-ONLY timeline note");
    expect(payload).toContain("PARTNER-ONLY knock on the door");
    // The admin stream is invisible — notes AND tasks (ADR-0044 symmetry).
    expect(payload).not.toContain("ADMIN-ONLY");

    // Status changes still show (status is one shared field, R-22), newest first.
    expect(activity.map((a) => a.kind)).toContain("status");
    const ats = activity.map((a) => a.at);
    expect([...ats].sort((a, b) => b.localeCompare(a))).toEqual(ats);

    // PRN-08: the portal timeline carries no admin-only routing facts and no identity
    // beyond the caller's own org — the admin feed's routed/assigned entries, the match
    // method, sibling-partner identity, and admin emails all stay out.
    expect(activity.some((a) => a.kind === "routed" || a.kind === "assigned")).toBe(false);
    expect(payload).not.toContain("zip"); // leads.match_method
    expect(payload).not.toContain("Yankee Homes"); // the sibling partner's name
    expect(payload).not.toContain("JV-002"); // …and its reference id
    expect(payload).not.toContain("admin@timeline.test");
    // Every status entry withholds its actor: R-22 lets an admin-authored entry through
    // to the owner, so the actor column is exactly where an admin identity would leak.
    expect(activity.filter((a) => a.kind === "status").every((a) => a.actor === null)).toBe(true);
    expect(activity.filter((a) => a.kind === "status").length).toBeGreaterThan(0);
  });

  it("TSK-06/R-22: a re-routed lead's new-owner timeline carries no prior-org notes, tasks, or status entries", async () => {
    // An ADMIN-authored status change BEFORE the re-route: R-22's owner decision keeps this
    // one visible to whoever owns the lead, unlike the partner-authored entry below.
    await updateLeadStatus(admin(), REF_RR, "Contacted");
    await addLeadNote(partnerX(), REF_RR, "X-PRIVATE seller intel");
    await addLeadTask(partnerX(), REF_RR, { title: "X-PRIVATE follow-up Tuesday" });
    await updateLeadStatus(partnerX(), REF_RR, "Appointment"); // authored by X's org

    // Admin re-routes the lead to partner Y (the manual overlay moves the effective owner).
    await db.update(schema.leads).set({ manualPartnerId: id.py }).where(eq(schema.leads.refId, REF_RR));

    const yDetail = await getPartnerLeadDetail(partnerY(), REF_RR);
    expect(yDetail).toBeTruthy();
    const yPayload = JSON.stringify(yDetail!.activity);
    expect(yPayload).not.toContain("X-PRIVATE");
    expect(yDetail!.activity.some((a) => a.kind === "note")).toBe(false);
    expect(yDetail!.activity.some((a) => a.kind === "task_created")).toBe(false);
    // No prior-PARTNER-authored status entry survives the re-route…
    expect(yDetail!.activity.some((a) => a.status === "Appointment")).toBe(false);
    // …but the admin-authored one does, actor withheld (R-22, owner decision 2026-08-07).
    const adminStatus = yDetail!.activity.find((a) => a.status === "Contacted");
    expect(adminStatus).toBeTruthy();
    expect(adminStatus!.actor).toBeNull();

    // Y's own stream works on the re-routed lead (the predicate is not over-broad).
    await addLeadNote(partnerY(), REF_RR, "Y note after re-route");
    const yAfter = await getPartnerLeadDetail(partnerY(), REF_RR);
    expect(JSON.stringify(yAfter!.activity)).toContain("Y note after re-route");
    expect(JSON.stringify(yAfter!.activity)).not.toContain("X-PRIVATE");

    // X lost the lead itself with the re-route (partnerOwnsLead revokes access).
    expect(await getPartnerLeadDetail(partnerX(), REF_RR)).toBeNull();

    // Admin keeps its own stream's view; the partner streams stay invisible to it.
    const adminDetail = await getAdminLeadDetail(admin(), REF_RR);
    expect(JSON.stringify(adminDetail!.activity)).not.toContain("X-PRIVATE");
    expect(JSON.stringify(adminDetail!.activity)).not.toContain("Y note after re-route");
  });

  it("TSK-06: task completion appears as its own timeline entry; an open task contributes only task_created", async () => {
    const { id: openTask } = await addLeadTask(admin(), REF_RR, { title: "open work item" });
    const { id: doneTask } = await addLeadTask(admin(), REF_RR, { title: "closed work item" });

    const before = (await getAdminLeadDetail(admin(), REF_RR))!.activity;
    expect(before.filter((a) => a.title === "open work item").map((a) => a.kind)).toEqual(["task_created"]);
    expect(before.filter((a) => a.title === "closed work item").map((a) => a.kind)).toEqual(["task_created"]);

    await completeLeadTask(admin(), doneTask);

    const after = (await getAdminLeadDetail(admin(), REF_RR))!.activity;
    // The open task still contributes exactly one entry…
    expect(after.filter((a) => a.title === "open work item").map((a) => a.kind)).toEqual(["task_created"]);
    // …the completed one contributes two, newest first, at distinct timestamps
    // (created_at and done_at are separate facts).
    const closed = after.filter((a) => a.title === "closed work item");
    expect(closed.map((a) => a.kind)).toEqual(["task_completed", "task_created"]);
    expect(closed[0].at >= closed[1].at).toBe(true);

    const [row] = await db.select({ doneAt: schema.leadTasks.doneAt }).from(schema.leadTasks).where(eq(schema.leadTasks.id, doneTask));
    expect(closed[0].at).toBe(row.doneAt!.toISOString());
    expect(openTask).toBeTruthy();
  });

  it("TSK-06/PRN-08: another tenant's admin reads neither this lead nor its timeline content", async () => {
    // Tenant B's admin holds a legitimate admin scope — for the WRONG workspace.
    expect(await getAdminLeadDetail(adminB(), REF_MAIN)).toBeNull();
    expect(await getPartnerLeadDetail(adminB(), REF_MAIN)).toBeNull();
    // …and tenant B's own content never bleeds into a tenant-A timeline (the note/task
    // reads are tenant-scoped by noteWhere/taskWhere, not by the lead join alone).
    for (const detail of [await getAdminLeadDetail(admin(), REF_MAIN), await getPartnerLeadDetail(partnerX(), REF_MAIN)]) {
      expect(JSON.stringify(detail!.activity)).not.toContain("TENANT-B-CONTENT");
    }
    // The reverse direction holds too: B's own timeline sees only B's content.
    const bDetail = await getAdminLeadDetail(adminB(), REF_B);
    expect(JSON.stringify(bDetail!.activity)).toContain("TENANT-B-CONTENT note");
    expect(JSON.stringify(bDetail!.activity)).not.toContain("ADMIN-ONLY");
  });

  it("TSK-06/R-65: a mis-tenanted author yields a null actor, never another tenant's email", async () => {
    // Written raw: no module path can produce this row (author identity comes from the
    // scope). It is the regression guard for the author joins' ON-clause tenant predicate —
    // drop that predicate and this test reports admin@timeline-b.test as the actor.
    const leadId = await leadIdOf(REF_CAP, id.tenant);
    await db.insert(schema.leadNotes).values({
      tenantId: id.tenant, leadId, authorUserId: id.adminUserB, authorRole: "admin", body: "MIS-TENANTED author note",
    });
    await db.insert(schema.leadTasks).values({
      tenantId: id.tenant, leadId, authorUserId: id.adminUserB, authorRole: "admin", title: "MIS-TENANTED author task",
    });

    const activity = (await getAdminLeadDetail(admin(), REF_CAP))!.activity;
    // The row still belongs to this tenant, so the ENTRY stays (dropping it would hide a
    // real note); only the actor is withheld.
    const note = activity.find((a) => a.body === "MIS-TENANTED author note");
    const task = activity.find((a) => a.title === "MIS-TENANTED author task");
    expect(note).toBeTruthy();
    expect(task).toBeTruthy();
    expect(note!.actor).toBeNull();
    expect(task!.actor).toBeNull();
    expect(JSON.stringify(activity)).not.toContain("admin@timeline-b.test");

    await db.delete(schema.leadNotes).where(eq(schema.leadNotes.leadId, leadId));
    await db.delete(schema.leadTasks).where(eq(schema.leadTasks.leadId, leadId));
  });

  it("TSK-06/PRN-08: a lead the caller cannot reach has no timeline — foreign, recalled, and held all return null", async () => {
    // BOLA: a sibling partner's lead, with no re-route anywhere in the picture.
    expect(await getPartnerLeadDetail(partnerY(), REF_MAIN)).toBeNull();

    // A still-HELD lead is not the partner's yet (distribution hold); admin is never gated.
    expect(await getPartnerLeadDetail(partnerX(), REF_HELD)).toBeNull();
    expect((await getAdminLeadDetail(admin(), REF_HELD))!.refId).toBe(REF_HELD);

    // A recalled (soft-deleted) lead drops out for BOTH roles (WP-J2).
    await addLeadNote(partnerX(), REF_DEL, "RECALLED-LEAD note");
    expect((await getPartnerLeadDetail(partnerX(), REF_DEL))!.refId).toBe(REF_DEL);
    await db.update(schema.leads).set({ deletedAt: new Date() }).where(eq(schema.leads.refId, REF_DEL));
    expect(await getPartnerLeadDetail(partnerX(), REF_DEL)).toBeNull();
    expect(await getAdminLeadDetail(admin(), REF_DEL)).toBeNull();
  });

  it("TSK-06: each contributed stream is capped at TIMELINE_STREAM_LIMIT, newest kept", async () => {
    const leadId = await leadIdOf(REF_CAP, id.tenant);
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    // One more than the cap, at strictly increasing timestamps: cap-note-000 is the oldest.
    const rows = Array.from({ length: TIMELINE_STREAM_LIMIT + 1 }, (_, i) => ({
      tenantId: id.tenant,
      leadId,
      authorUserId: id.adminUser,
      authorRole: "admin" as const,
      body: `cap-note-${String(i).padStart(3, "0")}`,
      createdAt: new Date(base + i * 60_000),
    }));
    await db.insert(schema.leadNotes).values(rows);

    const activity = (await getAdminLeadDetail(admin(), REF_CAP))!.activity;
    const notes = activity.filter((a) => a.kind === "note");
    expect(notes).toHaveLength(TIMELINE_STREAM_LIMIT);
    // The window keeps the NEWEST rows: the oldest fell out, the newest is present.
    const bodies = notes.map((n) => n.body);
    expect(bodies).not.toContain("cap-note-000");
    expect(bodies).toContain(`cap-note-${String(TIMELINE_STREAM_LIMIT).padStart(3, "0")}`);
    expect(bodies).toContain("cap-note-001");

    await db.delete(schema.leadNotes).where(eq(schema.leadNotes.leadId, leadId));
  });
});
