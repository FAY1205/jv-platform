import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { releaseTenantLeads } from "../helpers/hold";
import { matchMethodLabel } from "@/lib/match-method";
import type { ScopeContext } from "@/lib/scope";
import { getAdminLeadDetail } from "@/modules/leads/queries";
import { TIMELINE_STREAM_LIMIT, detailsUpdatedActivity } from "@/modules/leads/timeline";
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
const REF_SF = "LD-26-30006"; // routed by STATE FALLBACK (UXF-4.2 label fixture)
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
    // WP-NF2 NTF-11: task assignment and partner notes now write notifications, which FK
    // `users`. Must go before the users delete.
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
    await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.tenantId, tids));
    await db.delete(schema.notificationPrefOverrides).where(inArray(schema.notificationPrefOverrides.tenantId, tids));
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
    // UXF-4.2: the one lead routed by the OTHER match method — its routed label is where a
    // raw enum ("state_fallback") used to reach the screen.
    await db.insert(schema.leads).values({
      tenantId: t.id, refId: REF_SF, uploadId: up.id, dedupeKey: "tl|sf", rawJson: {},
      partnerId: py.id, matchMethod: "state_fallback" as const, mlsStatus: "kept" as const, campaign: "Campaign A",
    });
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
  /** ADR-0049 tiers: admin-STREAM, but without `ops.admin` (ADMIN_LOCKED) — see N5-14/AUTHZ-08. */
  const viewer = (): ScopeContext => ({ tenantId: id.tenant, role: "viewer", userId: id.adminUser });

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

  // UXF-4.2 (Scope-E audit §4.2): the routed entry is the one timeline label built from a
  // db enum. It must speak the SAME vocabulary as the lead dialog's ROUTED BY badge —
  // lib/match-method is the single display map for both — so no raw token ever surfaces.
  it("UXF-4.2: timeline routed label is humanized — no raw enum", async () => {
    const routedOf = async (ref: string) => {
      const activity = (await getAdminLeadDetail(admin(), ref))!.activity;
      const routed = activity.filter((a) => a.kind === "routed");
      expect(routed).toHaveLength(1);
      return routed[0].label;
    };

    // Both enum values, both partners — the label carries the partner NAME plus the badge's
    // own wording, and never the underlying token.
    expect(await routedOf(REF_MAIN)).toBe(`Routed to PX via ${matchMethodLabel("zip").label}`);
    expect(await routedOf(REF_MAIN)).toBe("Routed to PX via ZIP match");
    expect(await routedOf(REF_SF)).toBe(`Routed to Yankee Homes via ${matchMethodLabel("state_fallback").label}`);
    expect(await routedOf(REF_SF)).toBe("Routed to Yankee Homes via State fallback");

    // The regression guard proper: an enum token is snake_case, a sentence is not.
    for (const ref of [REF_MAIN, REF_SF]) {
      const label = await routedOf(ref);
      expect(label).not.toContain("_");
      expect(label).not.toContain("state_fallback");
    }
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

  it("N5-14: 'Details updated' entries come from lead.edited audit rows — names only, admin feed only, tenant-scoped", async () => {
    // Written raw so the exact `after` shapes editLead produces are under test, including
    // the partner-move keys it folds into the SAME row. Values here are what the audit trail
    // really holds: PII masked to a presence sentinel, routing/property fields raw.
    const at = (m: number) => new Date(Date.UTC(2026, 5, 1, 12, m, 0));
    await db.insert(schema.auditLog).values([
      // (a) a plain field edit
      { tenantId: id.tenant, actorUserId: id.adminUser, action: "lead.edited", entityType: "lead", entityRef: REF_SF, createdAt: at(1),
        before: { phone: "absent", email: "absent" }, after: { phone: "present", email: "present" } },
      // (b) a PARTNER-ONLY move: the `assigned` entry already tells this story
      { tenantId: id.tenant, actorUserId: id.adminUser, action: "lead.edited", entityType: "lead", entityRef: REF_SF, createdAt: at(2),
        before: { effectiveOwner: id.px }, after: { effectiveOwner: id.py, partner: { from: id.px, to: id.py, partnerRefId: "JV-002" } } },
      // (c) BOTH at once — one entry, listing only the field names
      { tenantId: id.tenant, actorUserId: id.adminUser, action: "lead.edited", entityType: "lead", entityRef: REF_SF, createdAt: at(3),
        before: { address: "1 Old St", effectiveOwner: id.py }, after: { address: "SECRET-VALUE-ADDRESS", effectiveOwner: id.px, partner: { from: id.py, to: id.px } } },
      // (d) ANOTHER TENANT's row carrying the same entity_ref — must never cross over
      { tenantId: id.tenantB, actorUserId: id.adminUserB, action: "lead.edited", entityType: "lead", entityRef: REF_SF, createdAt: at(4),
        before: {}, after: { campaign: "TENANT-B-CONTENT campaign" } },
      // (e) a MIS-TENANTED actor: the row is ours, the user is not (R-65 precedent)
      { tenantId: id.tenant, actorUserId: id.adminUserB, action: "lead.edited", entityType: "lead", entityRef: REF_SF, createdAt: at(5),
        before: { zip: "1" }, after: { zip: "2" } },
      // (f) a different action on the same lead — not a field edit, not an entry
      { tenantId: id.tenant, actorUserId: id.adminUser, action: "lead.recalled", entityType: "lead", entityRef: REF_SF, createdAt: at(6),
        before: {}, after: { phone: "present" } },
    ]);

    const activity = (await getAdminLeadDetail(admin(), REF_SF))!.activity;
    const entries = activity.filter((a) => a.kind === "details_updated");

    // (a), (c) and (e) — never (b), (d) or (f). Newest first, like the rest of the feed.
    expect(entries.map((e) => e.label)).toEqual([
      "Details updated: ZIP",
      "Details updated: address",
      "Details updated: phone, email",
    ]);
    // SEC-05: not one audited VALUE reaches the feed, masked or raw.
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("SECRET-VALUE-ADDRESS");
    expect(serialized).not.toContain("present");
    expect(serialized).not.toContain(id.py);
    // PRN-08: neither the other tenant's row nor its actor.
    expect(serialized).not.toContain("TENANT-B-CONTENT");
    expect(serialized).not.toContain("admin@timeline-b.test");
    // The actor join carries its own tenant predicate, so a mis-tenanted actor is withheld.
    expect(entries.find((e) => e.label === "Details updated: ZIP")!.actor).toBeNull();
    expect(entries.find((e) => e.label === "Details updated: phone, email")!.actor).toBe("admin@timeline.test");

    // ADMIN FEED ONLY: the partner who owns this lead sees no edit entries at all.
    const partnerFeed = (await getPartnerLeadDetail(partnerY(), REF_SF))!.activity;
    expect(partnerFeed.some((a) => a.kind === "details_updated")).toBe(false);
    expect(JSON.stringify(partnerFeed)).not.toContain("Details updated");

    await purgeAuditLog(db, eq(schema.auditLog.entityRef, REF_SF));
  });

  it("N5-14/AUTHZ-08: viewer tier does not receive Details updated entries (ops.admin band, owner-pending default)", async () => {
    await db.insert(schema.auditLog).values({
      tenantId: id.tenant, actorUserId: id.adminUser, action: "lead.edited", entityType: "lead", entityRef: REF_SF,
      createdAt: new Date(Date.UTC(2026, 5, 2, 12, 0, 0)),
      before: { phone: "absent" }, after: { phone: "present" },
    });

    // The band, not the stream: a viewer is admin-STREAM and holds `leads.read`, so the rest
    // of the record is theirs — but `audit_log` content sits behind `ops.admin` everywhere
    // else it surfaces (/api/activity, the AIS-11 assistant tool), and this entry is derived
    // from it. Non-vacuous by construction: the SAME lead, the SAME row, read twice.
    const asAdmin = (await getAdminLeadDetail(admin(), REF_SF))!.activity;
    expect(asAdmin.some((a) => a.kind === "details_updated")).toBe(true);

    const asViewer = (await getAdminLeadDetail(viewer(), REF_SF))!.activity;
    expect(asViewer.some((a) => a.kind === "details_updated")).toBe(false);
    expect(JSON.stringify(asViewer)).not.toContain("Details updated");
    // Everything else the viewer is entitled to is still there — the gate is on the ONE kind,
    // not on the feed (a blanked timeline would pass the assertion above for the wrong reason).
    expect(asViewer.some((a) => a.kind === "imported")).toBe(true);

    await purgeAuditLog(db, eq(schema.auditLog.entityRef, REF_SF));
  });

  it("N5-14/PRN-13: detailsUpdatedActivity REFUSES a partner scope rather than running the tenant-only predicate", async () => {
    // audit_log has no partner column, so there is no predicate that could make this safe:
    // a partner running it would read edits made while the PREVIOUS owner held the lead
    // (R-22). The guard is a throw, not a filter — the call site is the bug, not the data.
    const leadId = await leadIdOf(REF_SF, id.tenant);
    expect(leadId).toBeTruthy();
    await expect(detailsUpdatedActivity(db, partnerY(), REF_SF)).rejects.toThrow(/admin-stream only/i);
    // …and the admin path over the very same arguments still works, so the rejection above
    // is the guard firing and not a broken query.
    await expect(detailsUpdatedActivity(db, admin(), REF_SF)).resolves.toBeInstanceOf(Array);
  });
});
