import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { noteWhere, taskWhere, tenantWhere, type ScopeContext } from "@/lib/scope";

// ─────────────────────────────────────────────────────────────────────────────
// TSK-06: the unified per-lead timeline read-model, shared by the admin lead detail
// (modules/leads/queries) and the partner one (modules/portal/queries) so the two
// feeds can never drift. Read-only composition: every entry is derived from an
// authoritative table, and each contributed stream flows through ITS OWN scope
// builder (noteWhere / taskWhere) — never a hand-rolled tenant/author predicate
// (PRN-08). That is what makes the two-stream boundary (PRN-13, ADR-0044) and the
// re-route rule (R-22) hold on the timeline for free: an admin reads only admin
// notes/tasks, a partner only their own org's, and a re-routed lead carries none of
// the prior org's entries to its new owner.
//
// Note bodies and task titles are DATA a human typed (PRN-10) and consumer-adjacent
// PII (SEC-05): they are already served to these exact callers by the notes/tasks
// endpoints under the identical predicate, so carrying them here adds no exposure —
// but they must never reach a log or an audit payload (the write paths mask them).
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** System events + status (pre-existing) and the TSK-06 additions. The client-side
 *  filter chips (All / Tasks / Notes / Status) key off these — WP-TSK-4. */
export type LeadActivityKind =
  | "imported"
  | "routed"
  | "assigned"
  | "status"
  | "note"
  | "task_created"
  | "task_completed";

export interface LeadActivity {
  kind: LeadActivityKind;
  at: string;
  label: string;
  /** The acting user's email where the table records one, else null. */
  actor: string | null;
  /** kind "status" only. */
  status?: string;
  /** kind "note" only — the note body, rendered inline in the timeline. */
  body?: string;
  /** kinds "task_created" / "task_completed" only. */
  title?: string;
}

/**
 * Payload bound (FEP): the detail activity array was bounded by construction before
 * (3 system events + a lead's status history); notes and tasks are unbounded per lead,
 * so each contributes at most its most-recent N rows. A completed task contributes two
 * entries, so the task stream tops out at 2N. Both streams are ordered by created_at
 * desc, i.e. an old task completed today can fall outside the window — the per-lead
 * Tasks panel (WP-TSK-4) is the complete list; the timeline is a recent-history feed.
 */
export const TIMELINE_STREAM_LIMIT = 100;

/** The one ordering of a timeline: newest first. Sorts in place and returns the array. */
export function sortNewestFirst(entries: LeadActivity[]): LeadActivity[] {
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The note + task entries of one lead's timeline, for the READING scope (TSK-06).
 * `leadId` must already have been resolved through the caller's own lead guard
 * (leadWhere / visibleLeadsWhere), exactly as the notes and tasks modules do — the
 * scope builders below then bound the child rows independently, so neither read
 * leans on the other.
 */
export async function noteAndTaskActivity(db: DB, scope: ScopeContext, leadId: string): Promise<LeadActivity[]> {
  const [notes, tasks] = await Promise.all([
    db
      .select({ at: schema.leadNotes.createdAt, body: schema.leadNotes.body, actor: schema.users.email })
      .from(schema.leadNotes)
      // R-65 precedent: the author join carries its own tenant predicate, so a mis-set
      // author id resolves to NULL (no actor) rather than another tenant's email.
      .leftJoin(schema.users, and(eq(schema.users.id, schema.leadNotes.authorUserId), tenantWhere(schema.users, scope)))
      .where(and(noteWhere(scope, db), eq(schema.leadNotes.leadId, leadId)))
      .orderBy(desc(schema.leadNotes.createdAt))
      .limit(TIMELINE_STREAM_LIMIT),
    db
      .select({
        title: schema.leadTasks.title,
        createdAt: schema.leadTasks.createdAt,
        doneAt: schema.leadTasks.doneAt,
        actor: schema.users.email,
      })
      .from(schema.leadTasks)
      .leftJoin(schema.users, and(eq(schema.users.id, schema.leadTasks.authorUserId), tenantWhere(schema.users, scope)))
      .where(and(taskWhere(scope, db), eq(schema.leadTasks.leadId, leadId)))
      .orderBy(desc(schema.leadTasks.createdAt))
      .limit(TIMELINE_STREAM_LIMIT),
  ]);

  const entries: LeadActivity[] = [];
  // The actor is the note's/task's author. Under noteWhere/taskWhere a partner only ever
  // reads rows authored by their OWN org, so this can never surface another company's
  // (or an admin's) identity to a partner — the admin-authored status entries a partner
  // may see under R-22 keep their actor withheld in the portal assembly for that reason.
  for (const n of notes) {
    entries.push({ kind: "note", at: n.at.toISOString(), actor: n.actor, label: "Note added", body: n.body });
  }
  for (const t of tasks) {
    entries.push({ kind: "task_created", at: t.createdAt.toISOString(), actor: t.actor, label: "Task added", title: t.title });
    // TSK-04: completion is its own timeline fact, at its own timestamp. `actor` is null
    // because lead_tasks records WHEN a task was completed, not by whom (any member of the
    // authoring stream may complete it, TSK-11) — and the audit log, the only place that
    // identity exists, is deliberately not a timeline source (it is cross-stream).
    if (t.doneAt) {
      entries.push({ kind: "task_completed", at: t.doneAt.toISOString(), actor: null, label: "Task completed", title: t.title });
    }
  }
  return entries;
}
