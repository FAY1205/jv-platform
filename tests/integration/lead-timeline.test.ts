import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { releaseTenantLeads } from "../helpers/hold";
import type { ScopeContext } from "@/lib/scope";
import { getAdminLeadDetail } from "@/modules/leads/queries";
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

// LD-26-30001 stays with partner X; LD-26-30002 is re-routed X → Y mid-suite.
const REF_MAIN = "LD-26-30001";
const REF_RR = "LD-26-30002";

suite("TSK-06: unified lead timeline", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG]));
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
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222", status: "active" }).returning({ id: schema.partners.id });
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
    await db.insert(schema.leads).values([
      { tenantId: t.id, refId: REF_MAIN, uploadId: up.id, dedupeKey: "tl|1", rawJson: {}, partnerId: px.id, matchMethod: "zip" as const, mlsStatus: "kept" as const, campaign: "Campaign A" },
      { tenantId: t.id, refId: REF_RR, uploadId: up.id, dedupeKey: "tl|2", rawJson: {}, partnerId: px.id, matchMethod: "zip" as const, mlsStatus: "kept" as const },
    ]);
    await releaseTenantLeads(db, id.tenant);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const admin = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminUser });
  const partnerX = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });
  const partnerY = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pyUser, partnerId: id.py });

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
    const payload = JSON.stringify(activity);
    expect(payload).not.toContain("PARTNER-ONLY");
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
  });

  it("TSK-06/R-22: a re-routed lead's new-owner timeline carries no prior-org notes, tasks, or status entries", async () => {
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
    // R-22: X's status entry is the prior org's too — the new owner starts clean.
    expect(yDetail!.activity.some((a) => a.kind === "status")).toBe(false);

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
});
