import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import type { ScopeContext } from "@/lib/scope";
import { releaseTenantLeads } from "../helpers/hold";
import { REDACTED } from "@/modules/audit/redact";
import {
  listLeadTasks,
  addLeadTask,
  editLeadTask,
  completeLeadTask,
  reopenLeadTask,
  deleteLeadTask,
  listMyTasks,
  LeadNotFoundError,
  TaskNotFoundError,
  TaskClosedError,
  InvalidAssigneeError,
} from "@/modules/tasks/tasks";

// WP-TSK-2 (live): the lead-task module layer — two-stream visibility (TSK-02, ADR-0044),
// server-derived author/tenant, stream-checked assignees (TSK-03), idempotent complete/
// reopen (TSK-04), author-only delete (TSK-05), My Tasks paging (TSK-07), and SEC-05
// title redaction in the audit trail. Self-skips without DATABASE_URL. Run with
// node --env-file=.env.local.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-tasks-api";
const SLUG_B = "test-tasks-api-b";

suite("WP-TSK-2: lead tasks module (TSK-01..07)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  // Leads: X owned by partner X (released), Y owned by partner Y (released),
  // HELD owned by partner X but still inside the distribution-hold window.
  const REF_X = "LD-26-20001";
  const REF_Y = "LD-26-20002";
  const REF_HELD = "LD-26-20003";

  async function cleanup() {
    const tenants = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG, SLUG_B]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leadTasks).where(inArray(schema.leadTasks.tenantId, tids));
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

    const [t] = await db.insert(schema.tenants).values({ name: "Tasks API", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [tb] = await db.insert(schema.tenants).values({ name: "Tasks API B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantB = tb.id;

    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.py = py.id;

    id.adminUser = randomUUID();
    id.adminUser2 = randomUUID();
    id.pxUser = randomUUID();
    id.pxUser2 = randomUUID();
    id.pyUser = randomUUID();
    await db.insert(schema.users).values([
      { id: id.adminUser, tenantId: t.id, email: "admin@tasks-api.test", role: "admin" as const },
      { id: id.adminUser2, tenantId: t.id, email: "admin2@tasks-api.test", role: "admin" as const },
      { id: id.pxUser, tenantId: t.id, email: "px@tasks-api.test", role: "partner" as const, partnerId: px.id },
      { id: id.pxUser2, tenantId: t.id, email: "px2@tasks-api.test", role: "partner" as const, partnerId: px.id },
      { id: id.pyUser, tenantId: t.id, email: "py@tasks-api.test", role: "partner" as const, partnerId: py.id },
    ]);

    // Tenant B: an admin user (cross-tenant assignee probe) plus a lead to hang a foreign
    // task off, for the cross-tenant mutation-by-id case.
    id.adminUserB = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUserB, tenantId: tb.id, email: "admin@tasks-api-b.test", role: "admin" });
    const [upB] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "IM-26-202", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [leadB] = await db
      .insert(schema.leads)
      .values({ tenantId: tb.id, refId: "LD-26-20099", uploadId: upB.id, dedupeKey: "tb|9", rawJson: {}, matchMethod: "none", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    id.leadB = leadB.id;

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-201", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values([
      { tenantId: t.id, refId: REF_X, uploadId: up.id, dedupeKey: "tx|1", rawJson: {}, partnerId: px.id, matchMethod: "zip" as const, mlsStatus: "kept" as const },
      { tenantId: t.id, refId: REF_Y, uploadId: up.id, dedupeKey: "ty|2", rawJson: {}, partnerId: py.id, matchMethod: "zip" as const, mlsStatus: "kept" as const },
    ]);
    // Release the two leads past the distribution hold so partners can work them.
    await releaseTenantLeads(db, id.tenant);
    // …then add a lead that is STILL HELD (fresh created_at, after the bulk release).
    await db.insert(schema.leads).values({
      tenantId: t.id, refId: REF_HELD, uploadId: up.id, dedupeKey: "th|3", rawJson: {},
      partnerId: px.id, matchMethod: "zip", mlsStatus: "kept",
    });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const admin = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminUser });
  const partnerX = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });
  const partnerY = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pyUser, partnerId: id.py });

  const auditFor = async (action: string, entityRef: string) =>
    db
      .select({ action: schema.auditLog.action, before: schema.auditLog.before, after: schema.auditLog.after })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, id.tenant), eq(schema.auditLog.action, action), eq(schema.auditLog.entityRef, entityRef)));

  // ── TSK-01 / TSK-02: shape + two-stream visibility ────────────────────────

  it("TSK-01: a task round-trips its shape, with author/tenant derived from scope", async () => {
    const { id: taskId } = await addLeadTask(admin(), REF_X, { title: "Call the seller", dueOn: "2026-08-20" });
    const [row] = await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(row.title).toBe("Call the seller");
    expect(row.dueOn).toBe("2026-08-20");
    expect(row.doneAt).toBeNull();
    expect(row.remindedAt).toBeNull();
    // Never client-supplied: the author identity and tenant come from the scope + the
    // scoped lead lookup (audit F-1/F-3).
    expect(row.authorRole).toBe("admin");
    expect(row.authorUserId).toBe(id.adminUser);
    expect(row.tenantId).toBe(id.tenant);
    // TSK-03: assignee defaults to the creator.
    expect(row.assignedToUserId).toBe(id.adminUser);
  });

  it("TSK-02: admin sees only admin tasks; a partner sees only their own stream", async () => {
    await addLeadTask(admin(), REF_X, { title: "ADMIN-ONLY task" });
    await addLeadTask(partnerX(), REF_X, { title: "PARTNER-ONLY task" });

    const adminTitles = (await listLeadTasks(admin(), REF_X)).map((t) => t.title);
    expect(adminTitles).toContain("ADMIN-ONLY task");
    expect(adminTitles).not.toContain("PARTNER-ONLY task");

    const partnerTitles = (await listLeadTasks(partnerX(), REF_X)).map((t) => t.title);
    expect(partnerTitles).toContain("PARTNER-ONLY task");
    expect(partnerTitles).not.toContain("ADMIN-ONLY task");
  });

  it("TSK-02: a partner cannot create a task on a lead that isn't theirs", async () => {
    await expect(addLeadTask(partnerX(), REF_Y, { title: "sneaky" })).rejects.toBeInstanceOf(LeadNotFoundError);
    await expect(listLeadTasks(partnerX(), REF_Y)).rejects.toBeInstanceOf(LeadNotFoundError);
  });

  it("TSK-02: a partner cannot create a task on a held lead", async () => {
    // The lead is theirs but still inside the distribution-hold window (audit F-7).
    await expect(addLeadTask(partnerX(), REF_HELD, { title: "too early" })).rejects.toBeInstanceOf(LeadNotFoundError);
    await expect(listLeadTasks(partnerX(), REF_HELD)).rejects.toBeInstanceOf(LeadNotFoundError);
    // Admin is never hold-gated.
    await expect(addLeadTask(admin(), REF_HELD, { title: "admin may" })).resolves.toBeTruthy();
  });

  it("TSK-02: a partner cannot read or mutate an admin task even holding its id", async () => {
    const { id: adminTaskId } = await addLeadTask(admin(), REF_X, { title: "admin private" });
    await expect(editLeadTask(partnerX(), adminTaskId, { title: "hijacked" })).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(completeLeadTask(partnerX(), adminTaskId)).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(deleteLeadTask(partnerX(), adminTaskId)).rejects.toBeInstanceOf(TaskNotFoundError);
    const [row] = await db.select({ title: schema.leadTasks.title }).from(schema.leadTasks).where(eq(schema.leadTasks.id, adminTaskId));
    expect(row.title).toBe("admin private");
  });

  it("TSK-02: a tenant-B task id is inert against every mutation from tenant A (both roles)", async () => {
    // A task in tenant B, written directly (tenant A has no API that could create it).
    const [foreign] = await db
      .insert(schema.leadTasks)
      .values({ tenantId: id.tenantB, leadId: id.leadB, authorUserId: id.adminUserB, authorRole: "admin", title: "tenant B private work" })
      .returning({ id: schema.leadTasks.id });

    for (const scope of [admin(), partnerX()]) {
      await expect(editLeadTask(scope, foreign.id, { title: "hijacked" })).rejects.toBeInstanceOf(TaskNotFoundError);
      await expect(completeLeadTask(scope, foreign.id)).rejects.toBeInstanceOf(TaskNotFoundError);
      await expect(reopenLeadTask(scope, foreign.id)).rejects.toBeInstanceOf(TaskNotFoundError);
      await expect(deleteLeadTask(scope, foreign.id)).rejects.toBeInstanceOf(TaskNotFoundError);
    }

    // The row is byte-for-byte untouched — no partial write slipped through.
    const [row] = await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.id, foreign.id));
    expect(row.title).toBe("tenant B private work");
    expect(row.doneAt).toBeNull();
    expect(row.tenantId).toBe(id.tenantB);
  });

  it("TSK-02: a held lead's task is invisible in My Tasks and unmutatable by id", async () => {
    // Written directly: the API refuses to create it (proven above), so the row can only come
    // from outside the module — which is exactly the case the hold gate must still catch.
    const [held] = await db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, id.tenant), eq(schema.leads.refId, REF_HELD)));
    const [task] = await db
      .insert(schema.leadTasks)
      .values({ tenantId: id.tenant, leadId: held.id, authorUserId: id.pxUser, authorRole: "partner", title: "held-lead task" })
      .returning({ id: schema.leadTasks.id });

    const mine = await listMyTasks(partnerX(), { status: "open", page: 1 }, new Date("2026-08-15T12:00:00Z"));
    expect(mine.items.map((t) => t.title)).not.toContain("held-lead task");
    expect(mine.total).toBe(mine.items.length); // count and rows agree under the same predicate

    await expect(editLeadTask(partnerX(), task.id, { title: "peek" })).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(completeLeadTask(partnerX(), task.id)).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(deleteLeadTask(partnerX(), task.id)).rejects.toBeInstanceOf(TaskNotFoundError);

    const [row] = await db.select({ title: schema.leadTasks.title, doneAt: schema.leadTasks.doneAt }).from(schema.leadTasks).where(eq(schema.leadTasks.id, task.id));
    expect(row.title).toBe("held-lead task");
    expect(row.doneAt).toBeNull();

    await db.delete(schema.leadTasks).where(eq(schema.leadTasks.id, task.id));
  });

  // ── TSK-03: assignee stream/tenant validation ─────────────────────────────

  it("TSK-03: a task cannot be assigned outside the author's stream/tenant", async () => {
    // admin → a partner user (cross-stream)
    await expect(addLeadTask(admin(), REF_X, { title: "x", assignedToUserId: id.pxUser })).rejects.toBeInstanceOf(InvalidAssigneeError);
    // partner → an admin user (cross-stream)
    await expect(addLeadTask(partnerX(), REF_X, { title: "x", assignedToUserId: id.adminUser })).rejects.toBeInstanceOf(InvalidAssigneeError);
    // partner X → a user of ANOTHER partner org (cross-org, same stream)
    await expect(addLeadTask(partnerX(), REF_X, { title: "x", assignedToUserId: id.pyUser })).rejects.toBeInstanceOf(InvalidAssigneeError);
    // admin → an admin of ANOTHER tenant (cross-tenant)
    await expect(addLeadTask(admin(), REF_X, { title: "x", assignedToUserId: id.adminUserB })).rejects.toBeInstanceOf(InvalidAssigneeError);
    // …and an unknown id is refused, not silently nulled.
    await expect(addLeadTask(admin(), REF_X, { title: "x", assignedToUserId: randomUUID() })).rejects.toBeInstanceOf(InvalidAssigneeError);
    // None of the rejected attempts wrote a row.
    const rows = await db.select({ id: schema.leadTasks.id }).from(schema.leadTasks).where(and(eq(schema.leadTasks.tenantId, id.tenant), eq(schema.leadTasks.title, "x")));
    expect(rows).toHaveLength(0);
  });

  it("TSK-03: an in-stream teammate is a valid assignee, on create and on edit", async () => {
    const { id: taskId } = await addLeadTask(partnerX(), REF_X, { title: "shared work", assignedToUserId: id.pxUser2 });
    const [row] = await db.select({ a: schema.leadTasks.assignedToUserId }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(row.a).toBe(id.pxUser2);

    await editLeadTask(partnerX(), taskId, { assignedToUserId: id.pxUser });
    const [after] = await db.select({ a: schema.leadTasks.assignedToUserId }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(after.a).toBe(id.pxUser);
    // The same cross-stream guard applies on the edit path.
    await expect(editLeadTask(partnerX(), taskId, { assignedToUserId: id.adminUser })).rejects.toBeInstanceOf(InvalidAssigneeError);
  });

  it("TSK-01: a partial edit leaves untouched fields alone; an explicit null clears the due date", async () => {
    const { id: taskId } = await addLeadTask(admin(), REF_X, { title: "keeps its date", dueOn: "2026-08-20" });
    // Title-only edit must NOT wipe the due date (undefined = leave alone).
    await editLeadTask(admin(), taskId, { title: "renamed, same date" });
    const [kept] = await db.select({ title: schema.leadTasks.title, dueOn: schema.leadTasks.dueOn }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(kept.title).toBe("renamed, same date");
    expect(kept.dueOn).toBe("2026-08-20");

    // An explicit null clears it.
    await editLeadTask(admin(), taskId, { dueOn: null });
    const [cleared] = await db.select({ title: schema.leadTasks.title, dueOn: schema.leadTasks.dueOn }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(cleared.dueOn).toBeNull();
    expect(cleared.title).toBe("renamed, same date");

    // A null assignee falls back to the caller (TSK-03's default-to-creator rule).
    await editLeadTask(admin(), taskId, { assignedToUserId: null });
    const [assignee] = await db.select({ a: schema.leadTasks.assignedToUserId }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(assignee.a).toBe(id.adminUser);
  });

  // ── TSK-04: idempotent complete / reopen ──────────────────────────────────

  it("TSK-04: complete and reopen are idempotent — no second write, no duplicate audit", async () => {
    const { id: taskId } = await addLeadTask(admin(), REF_X, { title: "idempotence probe" });

    await completeLeadTask(admin(), taskId);
    const [first] = await db.select({ doneAt: schema.leadTasks.doneAt }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(first.doneAt).not.toBeNull();

    await completeLeadTask(admin(), taskId); // repeat of the current state = no-op
    const [second] = await db.select({ doneAt: schema.leadTasks.doneAt }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(second.doneAt!.getTime()).toBe(first.doneAt!.getTime()); // not re-stamped
    expect(await auditFor("task.completed", taskId)).toHaveLength(1);

    await reopenLeadTask(admin(), taskId);
    await reopenLeadTask(admin(), taskId); // no-op
    const [third] = await db.select({ doneAt: schema.leadTasks.doneAt }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(third.doneAt).toBeNull();
    expect(await auditFor("task.reopened", taskId)).toHaveLength(1);
  });

  it("TSK-04: a completed task cannot be edited or deleted (open-tasks-only)", async () => {
    const { id: taskId } = await addLeadTask(admin(), REF_X, { title: "closed work" });
    await completeLeadTask(admin(), taskId);
    await expect(editLeadTask(admin(), taskId, { title: "rewrite history" })).rejects.toBeInstanceOf(TaskClosedError);
    await expect(deleteLeadTask(admin(), taskId)).rejects.toBeInstanceOf(TaskClosedError);
    const [row] = await db.select({ title: schema.leadTasks.title }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(row.title).toBe("closed work");
  });

  it("TSK-04: a same-stream colleague can edit and complete a task they did not author", async () => {
    // The DELIBERATE divergence from notes (ADR-0044 / TSK-11): a task is the ORG's work
    // item, so edit/complete/reopen are stream-scoped, not author-scoped — only delete is
    // author-only. This case exists so a future author-check copy-pasted from notes.ts
    // (where every mutation IS author-only) fails a test instead of silently shipping.
    const { id: taskId } = await addLeadTask(partnerX(), REF_X, { title: "team work item" });
    const colleague: ScopeContext = { tenantId: id.tenant, role: "partner", userId: id.pxUser2, partnerId: id.px };

    await editLeadTask(colleague, taskId, { title: "colleague retitled it", dueOn: "2026-09-15" });
    const [edited] = await db.select({ title: schema.leadTasks.title, dueOn: schema.leadTasks.dueOn }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(edited.title).toBe("colleague retitled it");
    expect(edited.dueOn).toBe("2026-09-15");

    await completeLeadTask(colleague, taskId);
    const [done] = await db.select({ doneAt: schema.leadTasks.doneAt }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(done.doneAt).not.toBeNull();

    await reopenLeadTask(colleague, taskId);
    const [reopened] = await db.select({ doneAt: schema.leadTasks.doneAt }).from(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    expect(reopened.doneAt).toBeNull();

    // The colleague's actions are audited under THEIR user id, not the author's (DM-04).
    const audits = await auditFor("task.edited", taskId);
    expect(audits).toHaveLength(1);
    const [actor] = await db
      .select({ actorUserId: schema.auditLog.actorUserId })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "task.edited"), eq(schema.auditLog.entityRef, taskId)));
    expect(actor.actorUserId).toBe(id.pxUser2);

    // …but delete stays author-only (the boundary this test brackets).
    await expect(deleteLeadTask(colleague, taskId)).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  // ── TSK-05: author-only delete ────────────────────────────────────────────

  it("TSK-05: delete is author-only, open-tasks-only, and audited", async () => {
    const { id: mine } = await addLeadTask(admin(), REF_X, { title: "my own task" });
    await deleteLeadTask(admin(), mine);
    const gone = await db.select({ id: schema.leadTasks.id }).from(schema.leadTasks).where(eq(schema.leadTasks.id, mine));
    expect(gone).toHaveLength(0);
    expect(await auditFor("task.deleted", mine)).toHaveLength(1);

    // A same-stream colleague can SEE the task but cannot delete it (author-only).
    const { id: theirs } = await addLeadTask(partnerX(), REF_X, { title: "px task" });
    const colleague: ScopeContext = { tenantId: id.tenant, role: "partner", userId: id.pxUser2, partnerId: id.px };
    expect((await listLeadTasks(colleague, REF_X)).map((t) => t.title)).toContain("px task");
    await expect(deleteLeadTask(colleague, theirs)).rejects.toBeInstanceOf(TaskNotFoundError);
    const still = await db.select({ id: schema.leadTasks.id }).from(schema.leadTasks).where(eq(schema.leadTasks.id, theirs));
    expect(still).toHaveLength(1);
  });

  // ── SEC-05: the title never reaches the audit trail ───────────────────────

  it("SEC-05: task mutations are audited with the title REDACTED — never the raw text", async () => {
    const { id: taskId } = await addLeadTask(admin(), REF_X, { title: "call Jane at 555-000-1234" });
    await editLeadTask(admin(), taskId, { title: "call Jane back Tuesday" });
    await completeLeadTask(admin(), taskId);

    const created = await auditFor("task.created", taskId);
    const edited = await auditFor("task.edited", taskId);
    const completed = await auditFor("task.completed", taskId);
    expect(created).toHaveLength(1);
    expect(edited).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect((created[0].after as { title: string }).title).toBe(REDACTED);
    expect((edited[0].before as { title: string }).title).toBe(REDACTED);
    expect((edited[0].after as { title: string }).title).toBe(REDACTED);

    const payload = JSON.stringify([created, edited, completed]);
    expect(payload).not.toContain("call Jane");
    expect(payload).not.toContain("555-000-1234");
  });

  // ── TSK-02: re-route invisibility, through the module ─────────────────────

  it("TSK-02: a lead re-routed from X to Y does not expose X's tasks to Y", async () => {
    const { id: xTaskId } = await addLeadTask(partnerX(), REF_X, { title: "X-PRIVATE follow-up" });
    await db.update(schema.leads).set({ manualPartnerId: id.py }).where(eq(schema.leads.refId, REF_X));

    const yTitles = (await listLeadTasks(partnerY(), REF_X)).map((t) => t.title);
    expect(yTitles).not.toContain("X-PRIVATE follow-up");
    expect(yTitles).toHaveLength(0);
    await expect(editLeadTask(partnerY(), xTaskId, { title: "hijacked" })).rejects.toBeInstanceOf(TaskNotFoundError);

    // Y's own stream works on the re-routed lead; X lost the lead entirely.
    await addLeadTask(partnerY(), REF_X, { title: "Y task after re-route" });
    expect((await listLeadTasks(partnerY(), REF_X)).map((t) => t.title)).toEqual(["Y task after re-route"]);
    await expect(listLeadTasks(partnerX(), REF_X)).rejects.toBeInstanceOf(LeadNotFoundError);

    // Restore ownership for any later case.
    await db.update(schema.leads).set({ manualPartnerId: null }).where(eq(schema.leads.refId, REF_X));
  });

  // ── TSK-07: My Tasks ──────────────────────────────────────────────────────

  it("TSK-07: My Tasks lists the actor's open tasks, due_on ascending with nulls last", async () => {
    // A dedicated partner + lead so this case owns its data set.
    const [pz] = await db.insert(schema.partners).values({ tenantId: id.tenant, refId: "JV-003", name: "PZ", color: "#333", status: "active" }).returning({ id: schema.partners.id });
    const pzUser = randomUUID();
    await db.insert(schema.users).values({ id: pzUser, tenantId: id.tenant, email: "pz@tasks-api.test", role: "partner", partnerId: pz.id });
    const [up] = await db.select({ id: schema.uploads.id }).from(schema.uploads).where(eq(schema.uploads.tenantId, id.tenant));
    await db.insert(schema.leads).values({ tenantId: id.tenant, refId: "LD-26-20009", uploadId: up.id, dedupeKey: "tz|9", rawJson: {}, partnerId: pz.id, matchMethod: "zip", mlsStatus: "kept" });
    await releaseTenantLeads(db, id.tenant);
    const pzScope: ScopeContext = { tenantId: id.tenant, role: "partner", userId: pzUser, partnerId: pz.id };

    await addLeadTask(pzScope, "LD-26-20009", { title: "no due date" });
    await addLeadTask(pzScope, "LD-26-20009", { title: "due later", dueOn: "2026-09-01" });
    await addLeadTask(pzScope, "LD-26-20009", { title: "due first", dueOn: "2026-08-01" });
    const { id: doneId } = await addLeadTask(pzScope, "LD-26-20009", { title: "already done" });
    await completeLeadTask(pzScope, doneId);

    const open = await listMyTasks(pzScope, { status: "open", page: 1 }, new Date("2026-08-15T12:00:00Z"));
    expect(open.items.map((t) => t.title)).toEqual(["due first", "due later", "no due date"]);
    expect(open.total).toBe(3);
    expect(open.page).toBe(1);
    // TSK-10 grouping rides along, computed from the injected clock.
    expect(open.items.map((t) => t.group)).toEqual(["overdue", "upcoming", "none"]);
    // Each row links to its lead (TSK-07).
    expect(open.items.every((t) => t.leadRefId === "LD-26-20009")).toBe(true);

    const done = await listMyTasks(pzScope, { status: "done", page: 1 }, new Date("2026-08-15T12:00:00Z"));
    expect(done.items.map((t) => t.title)).toEqual(["already done"]);

    // Cross-stream: the admin's My Tasks never contains a partner task.
    const adminMine = await listMyTasks(admin(), { status: "open", page: 1 }, new Date("2026-08-15T12:00:00Z"));
    expect(adminMine.items.map((t) => t.title)).not.toContain("due first");
  });

  it("TSK-07: My Tasks paginates server-side", async () => {
    const p1 = await listMyTasks(admin(), { status: "open", page: 1, pageSize: 2 }, new Date("2026-08-15T12:00:00Z"));
    expect(p1.items.length).toBeLessThanOrEqual(2);
    expect(p1.pageSize).toBe(2);
    expect(p1.total).toBeGreaterThan(2);
    const p2 = await listMyTasks(admin(), { status: "open", page: 2, pageSize: 2 }, new Date("2026-08-15T12:00:00Z"));
    expect(p2.page).toBe(2);
    // Disjoint pages over one stable ordering.
    const overlap = p1.items.filter((a) => p2.items.some((b) => b.id === a.id));
    expect(overlap).toHaveLength(0);
  });
});
