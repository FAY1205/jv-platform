import { and, asc, count, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { leadWhere, taskWhere, requirePartner, type ScopeContext } from "@/lib/scope";
import { releasedLeads } from "../run/hold-filter";
import { maskAuditValue } from "@/modules/audit/redact";
import { groupByDue, utcDateString, type DueGroup } from "./dates";
import { MY_TASKS_PAGE_SIZE, type MyTasksQuery } from "./schema";

// WP-J2 / distribution hold: a partner can neither read nor write tasks on a recalled
// (soft-deleted) or still-HELD lead; admin keeps access. Same predicate notes.ts applies
// at lead resolution (audit F-7) — the one place a partner's lead reachability is decided.
const partnerLive = (scope: ScopeContext) =>
  scope.role === "partner" ? and(isNull(schema.leads.deletedAt), releasedLeads()) : undefined;

// ─────────────────────────────────────────────────────────────────────────────
// Two-stream lead tasks (TSK-01..07, ADR-0044) — the notes module's shape, applied to
// work items. Every path filters by author_role AND scope via taskWhere: an admin sees
// ONLY admin tasks; a partner sees ONLY their own org's tasks on leads they currently
// own. The two streams are mutually invisible (PRN-13 symmetry).
//
// Nothing identity-bearing is ever taken from the client: `author_role` comes from
// scope.role, `author_user_id` from scope.userId, and `tenant_id` from the leadWhere-scoped
// lead lookup by refId — never a raw lead_id or tenant_id off the request (audit F-1/F-3).
// Mutations re-resolve the row through `taskWhere ∩ id`, so a stolen task id is inert.
//
// Titles are free text a human typed on a lead — the same PII exposure as a note body —
// so audit payloads carry a presence-preserving mask, never the text (SEC-05, ADR-0031),
// and the retention paths sentinel the column itself (retention/purge REDACTED_TASK_TITLE).
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

export class LeadNotFoundError extends Error {
  constructor(refId: string) {
    super(`Lead ${refId} not found.`);
    this.name = "LeadNotFoundError";
  }
}
export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task ${id} not found.`);
    this.name = "TaskNotFoundError";
  }
}
/** TSK-04/TSK-05: a completed task is a permanent timeline fact — reopen it to change it. */
export class TaskClosedError extends Error {
  constructor(id: string) {
    super(`Task ${id} is completed; reopen it before editing or deleting.`);
    this.name = "TaskClosedError";
  }
}
/** TSK-03: the assignee must be an in-tenant user of the author's own stream. */
export class InvalidAssigneeError extends Error {
  constructor() {
    super("The assignee must be a member of your own team.");
    this.name = "InvalidAssigneeError";
  }
}

export interface LeadTaskView {
  id: string;
  title: string;
  dueOn: string | null;
  assignedToUserId: string | null;
  authorUserId: string;
  authorRole: string;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyTaskItem extends LeadTaskView {
  leadRefId: string;
  /** TSK-10 bucket, computed from the injected clock — never re-derived downstream (PRN-15). */
  group: DueGroup;
}

export interface MyTasksPage {
  items: MyTaskItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TaskInput {
  title: string;
  dueOn?: string | null;
  assignedToUserId?: string | null;
}
/** Edit patch: `undefined` leaves a field alone, an explicit `null` CLEARS it (a null
 *  assignee falls back to the caller, per TSK-03's default-to-creator rule). */
export type TaskPatch = Partial<TaskInput>;

/** Open first, then due date ascending with NULLS LAST, then oldest first — one ordering
 *  shared by the per-lead panel and My Tasks so paging and the panel never disagree. */
function taskOrder() {
  return [
    sql`${schema.leadTasks.doneAt} asc nulls first`,
    sql`${schema.leadTasks.dueOn} asc nulls last`,
    asc(schema.leadTasks.createdAt),
  ];
}

const TASK_COLUMNS = {
  id: schema.leadTasks.id,
  title: schema.leadTasks.title,
  dueOn: schema.leadTasks.dueOn,
  assignedToUserId: schema.leadTasks.assignedToUserId,
  authorUserId: schema.leadTasks.authorUserId,
  authorRole: schema.leadTasks.authorRole,
  doneAt: schema.leadTasks.doneAt,
  createdAt: schema.leadTasks.createdAt,
  updatedAt: schema.leadTasks.updatedAt,
} as const;

function toView(r: {
  id: string;
  title: string;
  dueOn: string | null;
  assignedToUserId: string | null;
  authorUserId: string;
  authorRole: string;
  doneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): LeadTaskView {
  return {
    id: r.id,
    title: r.title,
    dueOn: r.dueOn,
    assignedToUserId: r.assignedToUserId,
    authorUserId: r.authorUserId,
    authorRole: r.authorRole,
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Resolve a lead the caller may work, by reference id. The ONLY source of `lead_id` and
 *  `tenant_id` on the write path (audit F-3): both come from this scoped row, never the
 *  request. Partners additionally clear the live + distribution-hold gate (audit F-7). */
async function resolveLead(db: DB, scope: ScopeContext, leadRefId: string) {
  const [lead] = await db
    .select({ id: schema.leads.id, tenantId: schema.leads.tenantId })
    .from(schema.leads)
    .where(and(leadWhere(scope), eq(schema.leads.refId, leadRefId), partnerLive(scope)));
  if (!lead) throw new LeadNotFoundError(leadRefId);
  return lead;
}

/**
 * TSK-03 (audit F-2): the assignee must be an in-tenant user of the AUTHOR'S OWN stream —
 * an admin task goes to an admin of this tenant, a partner task to a user of the author's
 * own partner org. Never trust the id the client sent: it is re-read under the tenant +
 * stream predicate, and an unknown/foreign id is REFUSED (not silently nulled, which would
 * hide a mis-wired UI). Undefined/null defaults to the creator (TSK-03).
 */
async function resolveAssignee(db: DB, scope: ScopeContext, assignedToUserId?: string | null): Promise<string> {
  const target = assignedToUserId ?? scope.userId;
  const stream =
    scope.role === "admin"
      ? eq(schema.users.role, "admin")
      : eq(schema.users.partnerId, requirePartner(scope));
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, scope.tenantId), eq(schema.users.id, target), stream));
  if (!user) throw new InvalidAssigneeError();
  return user.id;
}

/** Re-resolve a task through the scope guard. `taskWhere ∩ id` is the whole authorization:
 *  a task id from another tenant, org, or stream simply does not resolve (PRN-08). */
async function resolveTask(db: DB, scope: ScopeContext, taskId: string) {
  const [task] = await db
    .select({
      id: schema.leadTasks.id,
      tenantId: schema.leadTasks.tenantId,
      title: schema.leadTasks.title,
      dueOn: schema.leadTasks.dueOn,
      assignedToUserId: schema.leadTasks.assignedToUserId,
      authorUserId: schema.leadTasks.authorUserId,
      doneAt: schema.leadTasks.doneAt,
    })
    .from(schema.leadTasks)
    .where(and(taskWhere(scope, db), eq(schema.leadTasks.id, taskId)));
  if (!task) throw new TaskNotFoundError(taskId);
  return task;
}

/** The caller's own task stream for one lead (admin stream OR partner stream). */
export async function listLeadTasks(scope: ScopeContext, leadRefId: string): Promise<LeadTaskView[]> {
  const db = getDb();
  const lead = await resolveLead(db, scope, leadRefId);
  const rows = await db
    .select(TASK_COLUMNS)
    .from(schema.leadTasks)
    .where(and(taskWhere(scope, db), eq(schema.leadTasks.leadId, lead.id)))
    .orderBy(...taskOrder());
  return rows.map(toView);
}

/** Add a task to the caller's stream (TSK-01). author_role/author_user_id come from the
 *  scope; tenant_id and lead_id from the scoped lead lookup. Audited (title masked). */
export async function addLeadTask(
  scope: ScopeContext,
  leadRefId: string,
  input: TaskInput,
  traceId?: string,
): Promise<{ id: string }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const lead = await resolveLead(tx, scope, leadRefId);
    const assignedToUserId = await resolveAssignee(tx, scope, input.assignedToUserId);
    const [task] = await tx
      .insert(schema.leadTasks)
      .values({
        tenantId: lead.tenantId,
        leadId: lead.id,
        authorUserId: scope.userId,
        authorRole: scope.role,
        assignedToUserId,
        title: input.title,
        dueOn: input.dueOn ?? null,
      })
      .returning({ id: schema.leadTasks.id });
    await tx.insert(schema.auditLog).values({
      tenantId: lead.tenantId,
      actorUserId: scope.userId,
      action: "task.created",
      entityType: "lead_task",
      entityRef: task.id,
      before: null,
      // SEC-05: presence-preserving mask, never the typed text (ADR-0031).
      after: { title: maskAuditValue(input.title), dueOn: input.dueOn ?? null, assignedToUserId, leadRefId },
      traceId: traceId ?? null,
    });
    return { id: task.id };
  });
}

/**
 * Edit an open task inside the caller's own stream. Open-tasks-only (TSK-04/05): a
 * completed task is a permanent timeline fact. Unlike delete this is NOT author-only —
 * a task is the org's work item, and the stream boundary is the trust boundary.
 */
export async function editLeadTask(
  scope: ScopeContext,
  taskId: string,
  patch: TaskPatch,
  traceId?: string,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const task = await resolveTask(tx, scope, taskId);
    if (task.doneAt !== null) throw new TaskClosedError(taskId);

    const set: { title?: string; dueOn?: string | null; assignedToUserId?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    // undefined = "leave alone", null = "clear" (assignee falls back to the caller). Keyed on
    // the VALUE, not `in`: a parser that materialises absent optional keys as undefined would
    // otherwise silently wipe a due date on a title-only edit.
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.dueOn !== undefined) set.dueOn = patch.dueOn;
    if (patch.assignedToUserId !== undefined) {
      set.assignedToUserId = await resolveAssignee(tx, scope, patch.assignedToUserId);
    }

    await tx.update(schema.leadTasks).set(set).where(eq(schema.leadTasks.id, taskId));
    await tx.insert(schema.auditLog).values({
      tenantId: task.tenantId,
      actorUserId: scope.userId,
      action: "task.edited",
      entityType: "lead_task",
      entityRef: taskId,
      before: { title: maskAuditValue(task.title), dueOn: task.dueOn, assignedToUserId: task.assignedToUserId },
      after: {
        title: maskAuditValue(set.title ?? task.title),
        dueOn: patch.dueOn !== undefined ? patch.dueOn : task.dueOn,
        assignedToUserId: set.assignedToUserId ?? task.assignedToUserId,
      },
      traceId: traceId ?? null,
    });
  });
}

/** TSK-04: mark done. IDEMPOTENT — completing an already-completed task writes nothing
 *  (no re-stamped done_at, no duplicate audit entry / timeline event). */
export async function completeLeadTask(scope: ScopeContext, taskId: string, traceId?: string): Promise<void> {
  await setDone(scope, taskId, true, traceId);
}

/** TSK-04: reopen. IDEMPOTENT in the same way — reopening an open task is a no-op. */
export async function reopenLeadTask(scope: ScopeContext, taskId: string, traceId?: string): Promise<void> {
  await setDone(scope, taskId, false, traceId);
}

async function setDone(scope: ScopeContext, taskId: string, done: boolean, traceId?: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const task = await resolveTask(tx, scope, taskId);
    const isDone = task.doneAt !== null;
    if (isDone === done) return; // already in the requested state — TSK-04 no-op

    const now = new Date();
    await tx
      .update(schema.leadTasks)
      .set({ doneAt: done ? now : null, updatedAt: now })
      .where(eq(schema.leadTasks.id, taskId));
    await tx.insert(schema.auditLog).values({
      tenantId: task.tenantId,
      actorUserId: scope.userId,
      action: done ? "task.completed" : "task.reopened",
      entityType: "lead_task",
      entityRef: taskId,
      before: { done: isDone },
      after: { done, title: maskAuditValue(task.title) },
      traceId: traceId ?? null,
    });
  });
}

/**
 * TSK-05: delete a task — AUTHOR-ONLY and open-tasks-only, audited. The scope guard
 * decides visibility; the author check then narrows to "my own row", so a same-stream
 * colleague who can read the task still cannot remove it. A completed task is permanent.
 */
export async function deleteLeadTask(scope: ScopeContext, taskId: string, traceId?: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const task = await resolveTask(tx, scope, taskId);
    // Author-only: indistinguishable from "not found" on purpose — a caller learns
    // nothing about rows they may not act on.
    if (task.authorUserId !== scope.userId) throw new TaskNotFoundError(taskId);
    if (task.doneAt !== null) throw new TaskClosedError(taskId);

    await tx.delete(schema.leadTasks).where(eq(schema.leadTasks.id, taskId));
    await tx.insert(schema.auditLog).values({
      tenantId: task.tenantId,
      actorUserId: scope.userId,
      action: "task.deleted",
      entityType: "lead_task",
      entityRef: taskId,
      before: { title: maskAuditValue(task.title), dueOn: task.dueOn, assignedToUserId: task.assignedToUserId },
      after: null,
      traceId: traceId ?? null,
    });
  });
}

/**
 * TSK-07: the actor's OWN tasks across every lead they can see — assigned to them, or
 * authored by them while unassigned (the same coalesce shape TSK-08's recipient rule
 * uses: assignee, falling back to author). taskWhere still bounds the set to the caller's
 * stream/org, so this predicate only narrows "my team's tasks" to "mine".
 *
 * Server-paginated (FEP-03) over the shared ordering; `now` is injected so the TSK-10
 * grouping stays a pure function of (dueOn, today) — the clock lives here at the adapter
 * boundary, not in the date logic.
 */
export async function listMyTasks(
  scope: ScopeContext,
  query: MyTasksQuery,
  now: Date = new Date(),
): Promise<MyTasksPage> {
  const db = getDb();
  const page = query.page;
  const pageSize = query.pageSize ?? MY_TASKS_PAGE_SIZE;
  const mine = or(
    eq(schema.leadTasks.assignedToUserId, scope.userId),
    and(isNull(schema.leadTasks.assignedToUserId), eq(schema.leadTasks.authorUserId, scope.userId)),
  );
  const where = and(
    taskWhere(scope, db),
    mine,
    query.status === "done" ? isNotNull(schema.leadTasks.doneAt) : isNull(schema.leadTasks.doneAt),
  );

  const [rows, totals] = await Promise.all([
    db
      .select({ ...TASK_COLUMNS, leadRefId: schema.leads.refId })
      .from(schema.leadTasks)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadTasks.leadId))
      .where(where)
      .orderBy(...taskOrder())
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(schema.leadTasks).where(where),
  ]);

  const today = utcDateString(now);
  return {
    items: rows.map((r) => ({ ...toView(r), leadRefId: r.leadRefId, group: groupByDue(r.dueOn, today) })),
    page,
    pageSize,
    total: totals[0]?.n ?? 0,
  };
}
