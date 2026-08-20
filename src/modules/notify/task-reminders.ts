import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantIdWhere, type ScopeContext } from "@/lib/scope";
import { APP_NAME } from "@/lib/app";
import { logError } from "@/lib/observability";
import { taskVisibleTo } from "../tasks/tasks";
import { enqueueEmail } from "./outbox";
import { createNotification } from "./notifications";
import { buildTaskDueReminder } from "./digests";
import { streamPrefRole } from "./prefs";
import { ensureSubjectToken, loadOverridesFor, loadTokensFor, resolveEffectiveChannel } from "./pref-overrides";
import { buildUnsubscribeLinks } from "./unsubscribe";
import type { UnsubscribeLinks } from "./email-template";
import { env } from "@/lib/env";

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

/** C-14 / WP-TSK-6a: retire a due task after this many ticks where the sweep found it due but could
 *  NOT resolve an eligible recipient (re-routed / mis-assigned / cross-stream). At 5-min ticks this is
 *  a ~30-min window for a re-assignment to make it deliverable before the sweep gives up + tells an
 *  admin. Retiring drops it from the sweep's candidate set, so an orphan stops being re-probed forever. */
export const REMINDER_ATTEMPTS_MAX = 6;

export interface RemindDueTasksOptions {
  tenantId: string;
  /** Absolute origin for the lead deep link (env.APP_URL), as releaseDueImports takes. */
  appBaseUrl: string;
  /** Today's UTC calendar date "YYYY-MM-DD" (TSK-10) — computed at the route boundary. */
  today: string;
  /** The same instant `today` came from: stamps reminded_at and gates the partner hold. */
  now: Date;
  limit?: number;
  /** C-14 / WP-TSK-6a: a wall-clock budget — the sweep stops claiming NEW tasks once real time passes
   *  this epoch-ms deadline, so one tenant's backlog can't consume the cron's 60s maxDuration (the
   *  remainder is picked up next tick). Undefined = no budget. Distinct from `now` (the injected
   *  eligibility/stamp clock, TSK-10) precisely because a budget is real elapsed time, not the run clock. */
  deadlineMs?: number;
  /** Real-time reader for the `deadlineMs` budget, injected so tests are deterministic. Default Date.now. */
  clockMs?: () => number;
}

/** One candidate recipient, as stored — role + org decide what they may see. Phase C:
 *  member/viewer assignees resolve like admins (taskVisibleTo's staff arm) and read the
 *  admin-stream preference bucket (streamPrefRole). */
interface Candidate {
  id: string;
  email: string;
  role: "admin" | "partner" | "member" | "viewer";
  partnerId: string | null;
}

/**
 * Nudge every open, past-due, not-yet-reminded task in one tenant. Returns how many
 * tasks were nudged (a task whose recipient cannot be resolved is skipped, not counted,
 * and stays eligible for a later tick once it is re-assigned).
 */
export async function remindDueTasks(db: DB, opts: RemindDueTasksOptions): Promise<{ reminded: number; retired: number }> {
  const clockMs = opts.clockMs ?? (() => Date.now());
  // C-14 (pr-reviewer F-1): once the shared budget has elapsed, skip this tenant ENTIRELY — before
  // even the due select / prefs / users lookups — so a many-tenant run past the deadline pays nothing
  // per remaining tenant, not just nothing per task. The in-loop break below still bounds one tenant
  // whose own sweep runs long. The remainder is picked up next tick.
  if (opts.deadlineMs !== undefined && clockMs() >= opts.deadlineMs) return { reminded: 0, retired: 0 };

  // WP-NF2b (owner decision 2026-08-20): the NTF-09 TENANT-LEVEL EARLY-OUT IS GONE, because the
  // thing it read is gone. There is no workspace mute any more — a tenant cannot switch task_due
  // off for everyone — so there is nothing this sweep could learn from one cheap read that would
  // let it skip the tenant. Muting is per SEAT now, and a seat's overlay is only knowable once
  // the candidate set is resolved.
  //
  // This DISSOLVES the deliberate asymmetry the old comment flagged (deferred-for-owner item 8):
  // the tenant row used to be the ONE ceiling a user overlay could not widen, so a seat that
  // opted INTO task-due email in a fully-muted tenant was silently ignored here while every
  // other emit honoured the same opt-in. Now every leg resolves the same way everywhere:
  // shipped default ⊕ that recipient's own overlay.
  //
  // Cost: a tenant whose every seat has muted task_due pays the due select + the recipient
  // resolution per tick instead of one settings read. Bounded and acceptable — the due select is
  // indexed and `limit`ed, and the two batch loads below (overlays + tokens) are still ONE query
  // each for the whole tick, so the per-task work stays in memory.
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
        // C-14 / WP-TSK-6a: skip tasks retired after too many undeliverable ticks — they've been
        // surfaced to an admin and must not be re-probed (2 visibility queries each) forever.
        lt(schema.leadTasks.reminderAttempts, REMINDER_ATTEMPTS_MAX),
      ),
    )
    .orderBy(asc(schema.leadTasks.dueOn), asc(schema.leadTasks.createdAt))
    .limit(opts.limit ?? 200);
  if (due.length === 0) return { reminded: 0, retired: 0 };

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
    // Phase C seat lifecycle (audit-tenancy F-7): a deactivated seat is refused a session
    // (resolveScope) and must likewise not be nudged — the staff twin of PTL-01 revocation.
    .where(and(tenantIdWhere(schema.users, opts.tenantId), inArray(schema.users.id, candidateIds), isNull(schema.users.deactivatedAt)));
  const usersById = new Map<string, Candidate>(userRows.map((u) => [u.id, u]));
  // NTF-10: ONE overlay load for the whole sweep's candidate set — the per-task gate below then
  // resolves in memory, so a 200-task tick still costs a single overrides read.
  const overrides = await loadOverridesFor(db, opts.tenantId, candidateIds);
  // NTF-14 (audit-data): and ONE token load, for the same reason. Without it every emailed task
  // called ensureSubjectToken inside its transaction — a SELECT per task to fetch one of a
  // handful of distinct tokens. A candidate with no row yet is absent here and falls back to the
  // minting path below, so a first-ever reminder still gets its links.
  const tokens = await loadTokensFor(db, opts.tenantId, candidateIds);

  let reminded = 0;
  let retired = 0;
  for (const task of due) {
    // C-14: honour the wall-clock budget — stop claiming NEW tasks once real time passes the
    // deadline. The remainder (including this task) stays eligible and is picked up next tick.
    if (opts.deadlineMs !== undefined && clockMs() >= opts.deadlineMs) break;
    try {
      const recipient = await resolveRecipient(db, opts, usersById, task);
      if (!recipient) {
        // C-14 / WP-TSK-6a: no eligible recipient this tick. Count the attempt; when it crosses
        // REMINDER_ATTEMPTS_MAX, RETIRE the task (drops from the sweep) and tell the tenant's admins
        // ONCE so an orphan is surfaced, not re-probed forever. The per-tenant advisory lock
        // serializes concurrent ticks so exactly one crosses the threshold and notifies. SEC-05: the
        // admin heads-up carries the lead ref + a generic message, never the task title (seller PII).
        if (await retireIfExhausted(db, opts, task)) retired++;
        // Keep the id-only observability line for the whole orphan class (retired or still retrying).
        logError("task_reminder_no_visible_recipient", { tenantId: opts.tenantId, taskId: task.id });
        continue;
      }
      // WP-NF2b: the recipient's OWN overlay over the shipped default, and nothing else — this
      // is now the only gate on the nudge, for every recipient, with no ceiling above it.
      const recipientRole = streamPrefRole(recipient.role);
      const channel = resolveEffectiveChannel(overrides.get(recipient.id) ?? null, recipientRole, "task_due");
      // NTF-09 (WP-NF1 D5) — owner-directed 2026-08-19, INVERTING the earlier pr-reviewer F-2
      // decision recorded here ("consume it anyway; the nudge decision was made and spent").
      // With every channel off there is no nudge to spend: burning the one-shot means that a
      // recipient who turns task_due back on the next day never hears about the tasks that came
      // due while it was off — silently, and unrecoverably, since reminded_at is terminal.
      // So: SKIP WITHOUT CLAIMING. No reminded_at stamp, no reminder_attempts increment (this
      // is not an orphan — the recipient resolved fine, so retiring it would mis-fire the
      // admin heads-up), not counted as reminded. The task stays eligible and the one-shot
      // fires on the first tick after that seat switches a channel back on.
      if (!channel.inApp && !channel.email) continue;

      // NTF-14: resolve the recipient's unsubscribe links BEFORE opening the claim transaction.
      // Minting is a WRITE, and doing it inside the transaction put it under the per-tenant
      // advisory lock — serializing every other tenant operation behind a round trip that has
      // nothing to do with claiming this task, and (measured) pushing a 4-task sweep past the
      // 30s test timeout on a slow pooler. Laziness is preserved exactly: nothing is minted
      // unless this recipient is actually about to be emailed. The per-tick `tokens` map is
      // updated so a second task for the same seat costs nothing at all.
      let unsubscribe: UnsubscribeLinks | undefined;
      if (channel.email) {
        let token = tokens.get(recipient.id);
        if (!token) {
          token = (await ensureSubjectToken(db, opts.tenantId, { userId: recipient.id })).token;
          tokens.set(recipient.id, token);
        }
        unsubscribe = buildUnsubscribeLinks({ baseUrl: env.APP_URL, token, role: recipientRole, event: "task_due" });
      }

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
        // Stream, not tier (Phase C): any admin-STREAM recipient (admin, and later
        // member/viewer) gets the admin deep-link; only partners get the portal one.
        const leadPath =
          recipient.role !== "partner"
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
            leadRef: fresh.leadRefId, // C-13: the title embeds the task free text — correlate for void/purge redaction
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
            // NTF-14: the recipient SEAT's token. Minted on `tx` so the row commits (or rolls
            // back) with the claim — a nudge and its unsubscribe capability appear together.
            // Base is env.APP_URL, not `appBaseUrl`: a capability link must resolve to the
            // canonical origin regardless of what a caller passed for deep links.
            unsubscribe, // resolved above, outside the lock
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
  return { reminded, retired };
}

/**
 * C-14 / WP-TSK-6a: increment an orphaned task's attempt counter and, when it crosses
 * REMINDER_ATTEMPTS_MAX, retire it (excluded from the sweep by `reminder_attempts < MAX`) and notify
 * the tenant's admins ONCE. Returns true only on the tick that actually retires it. The per-tenant
 * advisory lock (the same key void/persist/the nudge take) serializes concurrent ticks, so exactly
 * one increment crosses the threshold. The conditional `WHERE reminder_attempts < MAX` makes a
 * post-retirement increment a no-op, so the heads-up never re-fires. Best-effort: a throw here is
 * caught by the caller's per-task try, and the un-committed increment simply retries next tick.
 */
async function retireIfExhausted(
  db: DB,
  opts: RemindDueTasksOptions,
  task: { id: string; leadRefId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${opts.tenantId})::bigint)`);
    const [row] = await tx
      .update(schema.leadTasks)
      .set({ reminderAttempts: sql`${schema.leadTasks.reminderAttempts} + 1` })
      .where(
        and(
          tenantIdWhere(schema.leadTasks, opts.tenantId),
          eq(schema.leadTasks.id, task.id),
          lt(schema.leadTasks.reminderAttempts, REMINDER_ATTEMPTS_MAX),
        ),
      )
      .returning({ attempts: schema.leadTasks.reminderAttempts });
    if (!row || row.attempts < REMINDER_ATTEMPTS_MAX) return false; // still retrying (or already retired)
    // Crossed the threshold this tick → retired. Surface to the tenant's admins (generic — no
    // task-title PII). Query + insert on `tx` (the transaction's own connection) — reading via the
    // outer `db` here would deadlock a single-connection pool waiting on a connection tx holds.
    const admins = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      // Phase C DECISION (audit-tenancy F-8): the orphaned-task heads-up goes to the ADMIN
      // TIER only (an ops signal). Task-due nudges themselves reach ANY staff assignee —
      // see resolveRecipient + streamPrefRole.
      .where(and(tenantIdWhere(schema.users, opts.tenantId), eq(schema.users.role, "admin"), isNull(schema.users.deactivatedAt)));
    // Deliberately ALWAYS-ON + in-app only (pr-reviewer F-2): unlike task_due, this retirement alert
    // has no prefs entry and never emails — it's a rare, operationally-important "someone needs to
    // re-assign this" signal an admin should not be able to mute into silence. Not a prefs-gated event.
    for (const admin of admins) {
      await createNotification(tx, {
        tenantId: opts.tenantId,
        userId: admin.id,
        type: "task_reminder_orphaned",
        title: "A task reminder couldn't be delivered",
        body: `A due task on lead ${task.leadRefId} has no eligible recipient and was retired after ${REMINDER_ATTEMPTS_MAX} attempts — check its assignment.`,
        deepLink: `/leads?open=${encodeURIComponent(task.leadRefId)}`,
        leadRef: task.leadRefId, // C-13: correlate for void/purge redaction (lead ref, not seller PII)
      });
    }
    return true;
  });
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
