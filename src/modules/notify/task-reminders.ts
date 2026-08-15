import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantIdWhere, type ScopeContext } from "@/lib/scope";
import { APP_NAME } from "@/lib/app";
import { logError } from "@/lib/observability";
import { taskVisibleTo } from "../tasks/tasks";
import { enqueueEmail } from "./outbox";
import { createNotification } from "./notifications";
import { buildTaskDueReminder } from "./digests";
import { loadNotificationPrefs, resolvePref } from "./prefs";

// ─────────────────────────────────────────────────────────────────────────────
// Due-task reminders (TSK-08). A sibling duty of the drain-outbox cron, exactly like
// releaseDueImports: tenant-scoped (PRN-08), best-effort per row, and driven by an
// injected clock (TSK-10 — `today` is computed ONCE at the route boundary, never here).
//
// Exactly ONE nudge per task, ever. The guarantee is not a read-then-write check: the
// sweep stamps `reminded_at` with a CONDITIONAL update (`WHERE reminded_at IS NULL`)
// and notifies only when that update actually claimed a row, so two cron ticks racing
// on the same task produce one nudge and one no-op (the WP-TSK-2 atomic-write pattern).
// The stamp and the notification insert commit in the SAME transaction, so a failed
// enqueue rolls the stamp back and the task is retried on the next tick rather than
// being silently consumed.
//
// Recipient = assignee, falling back to author (the coalesce shape listMyTasks uses).
// BINDING (WP-TSK-1 tenancy audit F-2): the recipient is resolved THROUGH `taskWhere`
// for a ScopeContext built for THAT person — never a raw assigned_to_user_id join. A
// re-routed, mis-assigned or cross-stream recipient cannot read the task, so they are
// not told about it; the author is tried next, and if nobody can read it the sweep
// logs (ids only, SEC-05) and skips without stamping.
//
// The partner arm's "never nudge a held lead" guarantee rests on HOLD_WINDOW_MS ===
// VOID_WINDOW_MS (hold-window.ts): a lead becomes partner-visible at the exact moment it
// stops being voidable, so no partner is ever emailed about a lead that can still be
// recalled. Pinned by "TSK-08: the void window never exceeds the hold window".
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

export interface RemindDueTasksOptions {
  tenantId: string;
  /** Absolute origin for the lead deep link (env.APP_URL), as releaseDueImports takes. */
  appBaseUrl: string;
  /** Today's UTC calendar date "YYYY-MM-DD" (TSK-10) — computed at the route boundary. */
  today: string;
  /** The same instant `today` came from: stamps reminded_at and gates the partner hold. */
  now: Date;
  limit?: number;
}

/** One candidate recipient, as stored — role + org decide what they may see. */
interface Candidate {
  id: string;
  email: string;
  role: "admin" | "partner";
  partnerId: string | null;
}

/**
 * Nudge every open, past-due, not-yet-reminded task in one tenant. Returns how many
 * tasks were nudged (a task whose recipient cannot be resolved is skipped, not counted,
 * and stays eligible for a later tick once it is re-assigned).
 */
export async function remindDueTasks(db: DB, opts: RemindDueTasksOptions): Promise<{ reminded: number }> {
  const due = await db
    .select({
      id: schema.leadTasks.id,
      title: schema.leadTasks.title,
      dueOn: schema.leadTasks.dueOn,
      assignedToUserId: schema.leadTasks.assignedToUserId,
      authorUserId: schema.leadTasks.authorUserId,
      leadRefId: schema.leads.refId,
      city: schema.leads.city,
      state: schema.leads.state,
    })
    .from(schema.leadTasks)
    // R-65 / ADR-0013: the join carries its OWN tenant predicate rather than trusting the FK
    // to keep a task and its lead in one tenant (audit-tenancy F-5).
    .innerJoin(
      schema.leads,
      and(eq(schema.leads.id, schema.leadTasks.leadId), tenantIdWhere(schema.leads, opts.tenantId)),
    )
    .where(
      and(
        tenantIdWhere(schema.leadTasks, opts.tenantId),
        isNull(schema.leadTasks.doneAt), // open only (TSK-08); serves the partial open_due index
        isNull(schema.leadTasks.remindedAt), // never nudged before
        // An undated task is never swept (TSK-08). `lte` on NULL is already NULL/false —
        // this states the rule rather than leaning on three-valued logic to imply it.
        isNotNull(schema.leadTasks.dueOn),
        lte(schema.leadTasks.dueOn, opts.today),
        // A recalled (voided) lead is dead for both roles: My Tasks already drops its tasks
        // (liveLeadGate), and WP-GL-B has replaced the title with the redaction sentinel —
        // there is nothing left worth emailing about.
        isNull(schema.leads.deletedAt),
      ),
    )
    .orderBy(asc(schema.leadTasks.dueOn), asc(schema.leadTasks.createdAt))
    .limit(opts.limit ?? 200);
  if (due.length === 0) return { reminded: 0 };

  // Prefs are per tenant (NTF-05) — one load for the whole sweep. userId is unused by the
  // settings read; releaseDueImports builds the same system scope.
  const systemScope: ScopeContext = { tenantId: opts.tenantId, role: "admin", userId: opts.tenantId };
  const prefs = await loadNotificationPrefs(db, systemScope);

  const candidateIds = [
    ...new Set(due.flatMap((t) => [t.assignedToUserId, t.authorUserId]).filter((v): v is string => v !== null)),
  ];
  const userRows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
      partnerId: schema.users.partnerId,
    })
    .from(schema.users)
    .where(and(tenantIdWhere(schema.users, opts.tenantId), inArray(schema.users.id, candidateIds)));
  const usersById = new Map<string, Candidate>(userRows.map((u) => [u.id, u]));

  let reminded = 0;
  for (const task of due) {
    try {
      const recipient = await resolveRecipient(db, opts, usersById, task);
      if (!recipient) {
        // SEC-05: ids only — never the title, the seller, or the recipient's address.
        logError("task_reminder_no_visible_recipient", { tenantId: opts.tenantId, taskId: task.id });
        continue;
      }
      const channel = resolvePref(prefs, recipient.role, "task_due");

      const nudged = await db.transaction(async (tx) => {
        // The SAME per-tenant lock key voidUpload / persistRun / releaseDueImports take, so a
        // void cannot interleave with a claim (audit-tenancy F-1). Without it the title and
        // location selected above could already be pre-redaction values by the time this
        // transaction commits — i.e. we would email the very seller text the void just purged.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${opts.tenantId})::bigint)`);

        // Re-read under the lock, re-validating the SAME eligibility predicate as the sweep's
        // select. This is the authoritative content: a lead voided since selection is gone from
        // this result (its task title is now the redaction sentinel), and so is a task completed
        // or re-dated in the meantime. Abort WITHOUT stamping — nothing has been written yet, so
        // the task stays eligible if it legitimately comes back into scope.
        const [fresh] = await tx
          .select({
            title: schema.leadTasks.title,
            dueOn: schema.leadTasks.dueOn,
            leadRefId: schema.leads.refId,
            city: schema.leads.city,
            state: schema.leads.state,
          })
          .from(schema.leadTasks)
          .innerJoin(
            schema.leads,
            and(eq(schema.leads.id, schema.leadTasks.leadId), tenantIdWhere(schema.leads, opts.tenantId)),
          )
          .where(
            and(
              tenantIdWhere(schema.leadTasks, opts.tenantId),
              eq(schema.leadTasks.id, task.id),
              isNull(schema.leadTasks.doneAt),
              isNotNull(schema.leadTasks.dueOn),
              lte(schema.leadTasks.dueOn, opts.today),
              isNull(schema.leads.deletedAt),
            ),
          );
        if (!fresh) return false;

        const overdue = (fresh.dueOn as string) < opts.today;
        const leadPath =
          recipient.role === "admin"
            ? `/leads?open=${encodeURIComponent(fresh.leadRefId)}`
            : `/portal/leads/${encodeURIComponent(fresh.leadRefId)}`;

        // The whole idempotency guarantee, in one statement: claim the row by flipping a
        // NULL reminded_at. Zero rows affected = another tick (or another instance) already
        // nudged this task, so nothing is sent. `updated_at` is deliberately NOT touched —
        // a system stamp is not a user edit and must not reorder anyone's task list.
        const claimed = await tx
          .update(schema.leadTasks)
          .set({ remindedAt: opts.now })
          .where(
            and(
              tenantIdWhere(schema.leadTasks, opts.tenantId),
              eq(schema.leadTasks.id, task.id),
              isNull(schema.leadTasks.remindedAt),
            ),
          )
          .returning({ id: schema.leadTasks.id });
        if (claimed.length === 0) return false;

        if (channel.inApp) {
          await createNotification(tx, {
            tenantId: opts.tenantId,
            userId: recipient.id,
            type: "task_due",
            title: `Task due: ${fresh.title}`,
            body: `Lead ${fresh.leadRefId} — ${overdue ? `overdue since ${fresh.dueOn}` : "due today"}.`,
            deepLink: leadPath,
          });
        }
        if (channel.email) {
          const content = buildTaskDueReminder({
            appName: APP_NAME,
            taskTitle: fresh.title,
            dueOn: fresh.dueOn as string,
            overdue,
            leadRef: fresh.leadRefId,
            city: fresh.city,
            state: fresh.state,
            leadUrl: `${opts.appBaseUrl}${leadPath}`,
          });
          await enqueueEmail(tx, {
            tenantId: opts.tenantId,
            to: recipient.email,
            subject: content.subject,
            body: content.body,
            html: content.html,
            kind: "task_due",
            meta: { leadRef: fresh.leadRefId },
          });
        }
        return true;
      });
      if (nudged) reminded++;
    } catch (e) {
      // Best-effort per task, mirroring releaseDueImports: one bad row never costs the rest
      // of the tenant its nudges, and the failed row's stamp rolled back with its transaction.
      logError("task_reminder_failed", {
        tenantId: opts.tenantId,
        taskId: task.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { reminded };
}

/**
 * Assignee first, then author — each tested through `taskWhere` for a scope built for THAT
 * user (BINDING, audit F-2). Returns undefined when neither can read the task.
 */
async function resolveRecipient(
  db: DB,
  opts: RemindDueTasksOptions,
  usersById: Map<string, Candidate>,
  task: { id: string; assignedToUserId: string | null; authorUserId: string },
): Promise<Candidate | undefined> {
  const ordered = [task.assignedToUserId, task.authorUserId].filter((v): v is string => v !== null);
  for (const userId of [...new Set(ordered)]) {
    const user = usersById.get(userId);
    if (!user) continue; // not in this tenant (or gone) — the guard would refuse them anyway
    // A partner row with no org cannot be scoped at all (requirePartner would throw): treat
    // it as "cannot see", which is exactly what it is.
    if (user.role === "partner" && !user.partnerId) continue;
    const scope: ScopeContext = {
      tenantId: opts.tenantId,
      role: user.role,
      userId: user.id,
      ...(user.partnerId ? { partnerId: user.partnerId } : {}),
    };
    // The partner arm of this check also carries the distribution hold and the soft-delete
    // filter, so a partner is never nudged about a held or recalled lead's task.
    if (await taskVisibleTo(db, scope, task.id, opts.now)) return user;
  }
  return undefined;
}
