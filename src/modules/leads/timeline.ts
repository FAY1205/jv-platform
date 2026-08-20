import { and, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { isPartnerStream, noteWhere, taskWhere, tenantWhere, type ScopeContext } from "@/lib/scope";

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
  | "task_completed"
  /** N5-14 — an admin corrected one or more of the lead's fields. ADMIN FEED ONLY. */
  | "details_updated";

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
 * entries, so the task stream tops out at 2N. Notes take the newest by created_at; tasks
 * take the newest by LAST TOUCH — greatest(created_at, done_at) — so completing a
 * long-open task pulls it back into the window instead of leaving the newest entry on the
 * timeline invisible. The per-lead Tasks panel (WP-TSK-4) remains the complete list.
 */
export const TIMELINE_STREAM_LIMIT = 100;

/** The one ordering of a timeline: newest first. Sorts in place and returns the array. */
export function sortNewestFirst(entries: LeadActivity[]): LeadActivity[] {
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

// ── "Details updated" (N5-14) ────────────────────────────────────────────────
// Inline per-field editing needs a timeline fact, and `lead.edited` audit rows already hold
// exactly which keys changed. Names only, never values: the audit payload masks consumer PII
// to a presence sentinel (SEC-05/ADR-0031), and the unmasked half (address, campaign) is no
// more welcome in a feed. Before→after diffs are N7's job, not this entry's.

/**
 * Display names for the audited lead columns — and, being an ALLOWLIST, the filter that
 * decides whether a row produces an entry at all. `editLead` folds a partner move into the
 * SAME audit row (`effectiveOwner`, `partner`), and those keys are absent here, so a
 * partner-only row yields no entry (the `assigned` entry already tells that story) and a
 * mixed row lists only its field names. An unrecognised key can never reach the screen.
 *
 * Lower case by design: the label reads mid-sentence ("Details updated: phone, email"). ZIP
 * keeps its acronym case rather than making a lowercase rule special-case it — the same call
 * `matchMethodLabel` made for "ZIP match".
 */
export const LEAD_FIELD_DISPLAY_NAMES: Record<string, string> = {
  sellerFirst: "seller first name",
  sellerLast: "seller last name",
  phone: "phone",
  email: "email",
  address: "address",
  city: "city",
  state: "state",
  zip: "ZIP",
  campaign: "source",
  reasonForSelling: "reason for selling",
  motivation: "motivation",
  timeToSell: "time to sell",
  notes: "source notes",
};

/**
 * The label one `lead.edited` audit row produces, or null when it produces none. Pure, so
 * the "no values ever surface" rule is provable without a database. Reads the row's `after`
 * KEYS only — the values are never touched.
 */
export function detailsUpdatedLabel(after: unknown): string | null {
  if (!after || typeof after !== "object" || Array.isArray(after)) return null;
  const changed = new Set(Object.keys(after as Record<string, unknown>));
  const names = Object.keys(LEAD_FIELD_DISPLAY_NAMES)
    .filter((k) => changed.has(k))
    .map((k) => LEAD_FIELD_DISPLAY_NAMES[k]);
  if (names.length === 0) return null;
  return `Details updated: ${names.join(", ")}`;
}

/**
 * The "Details updated" entries of one lead's timeline (N5-14).
 *
 * ⚠️ ADMIN FEED ONLY. `audit_log` carries no partner dimension, so the only predicate
 * available here is the tenant one — which is right for an admin (they own the whole tenant)
 * and would be a PRN-13 leak in the portal, where a partner must not learn what the previous
 * owner's record looked like. Widening the portal feed is an owner decision, and would need
 * a scope builder that does not exist yet. The lead is addressed by `entityRef` (its refId,
 * what the audit trail records) under the tenant predicate, exactly as the trail is written.
 */
export async function detailsUpdatedActivity(db: DB, scope: ScopeContext, leadRefId: string): Promise<LeadActivity[]> {
  // REFUSE rather than widen (the `requirePartner` / `streamUsersWhere` posture): there is no
  // partner predicate to add here, because `audit_log` has no partner column. A partner scope
  // arriving would therefore run the TENANT predicate and hand a partner the whole tenant's
  // edit history for the lead — including edits made while the PREVIOUS owner held it (R-22 /
  // PRN-13). A future portal feed needs a scope builder that does not exist yet, and an owner
  // decision; until both, this call site is a programming error, not a data question.
  if (isPartnerStream(scope)) {
    throw new Error("detailsUpdatedActivity is admin-stream only — audit_log carries no partner predicate.");
  }

  const rows = await db
    .select({ at: schema.auditLog.createdAt, after: schema.auditLog.after, actor: schema.users.email })
    .from(schema.auditLog)
    // R-65 precedent: the actor join carries its own tenant predicate, so a mis-set actor id
    // resolves to NULL (no actor) rather than surfacing another tenant's email.
    .leftJoin(schema.users, and(eq(schema.users.id, schema.auditLog.actorUserId), tenantWhere(schema.users, scope)))
    .where(
      and(
        tenantWhere(schema.auditLog, scope),
        eq(schema.auditLog.entityType, "lead"),
        eq(schema.auditLog.entityRef, leadRefId),
        eq(schema.auditLog.action, "lead.edited"),
      ),
    )
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(TIMELINE_STREAM_LIMIT);

  const entries: LeadActivity[] = [];
  for (const r of rows) {
    const label = detailsUpdatedLabel(r.after);
    if (!label) continue;
    entries.push({ kind: "details_updated", at: r.at.toISOString(), actor: r.actor, label });
  }
  return entries;
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
      // Last touch, not creation: a task created long ago but completed today still belongs
      // in the window it just produced an entry for. done_at is nullable, hence the coalesce.
      .orderBy(desc(sql`greatest(${schema.leadTasks.createdAt}, coalesce(${schema.leadTasks.doneAt}, ${schema.leadTasks.createdAt}))`))
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
