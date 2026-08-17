import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { drainOutbox, releaseDueImports } from "@/modules/notify/outbox";
import { remindDueTasks } from "@/modules/notify/task-reminders";
import { utcDateString } from "@/modules/tasks/dates";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { CRON_MONITORS, withCronMonitor } from "@/lib/cron-monitors";

// F-07: bound the scheduled function's runtime.
export const maxDuration = 60;

// C-14 / WP-TSK-6a: a wall-clock budget for the (unbounded) reminder sweeps across all tenants. Once
// real time passes runStart + this, remindDueTasks stops claiming new tasks (remainder next tick), so
// one tenant's backlog can't push this job past its 60s maxDuration + check-in. Half the budget leaves
// the other half for release/drain, which run first per tenant.
const REMINDER_BUDGET_MS = 30_000;

// ACT-05 (ADR-0032): this job's Sentry check-in identity + schedule.
const MONITOR = CRON_MONITORS["/api/cron/drain-outbox"];

// GET /api/cron/drain-outbox — scheduled outbox drain (Vercel Cron, vercel.json).
// Authorized by the CRON_SECRET bearer, NOT a session/CSRF. Drains EACH tenant's outbox
// (every drainOutbox call is tenant-scoped — PRN-08; the only cross-tenant read is the
// tenant-id list, a system operation). Non-production sends to the email sink (SEC-07).
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return jsonError("unauthorized", "Authentication required.", 401);
  }
  // ACT-05: check in with Sentry around the real work, so a run that never happens is
  // itself an alert. Wrapped AFTER the auth gate — a rejected caller is not a job run.
  //
  // The tenant-list failure deliberately THROWS out of this callback rather than
  // returning an error response: withMonitor finishes the check-in "ok" whenever the
  // callback RESOLVES and never inspects the resolved value, so returning a 500 from in
  // here would report a totally failed run as healthy — the exact false green ACT-05
  // exists to prevent. The rejection handler below restores the uniform envelope.
  return withCronMonitor(
    MONITOR,
    async () => {
      const db = getDb();
      const tenants: { id: string }[] = await db.select({ id: schema.tenants.id }).from(schema.tenants);
      // TSK-10: ONE clock for the whole run, read here at the adapter boundary — the sweep's
      // module logic never calls Date.now(), and every tenant in a tick sees the same "today"
      // (so a run straddling midnight UTC can't nudge one tenant on two different calendars).
      const now = new Date();
      const today = utcDateString(now);
      // C-14: the shared reminder-sweep deadline (real elapsed time from run start).
      const reminderDeadlineMs = now.getTime() + REMINDER_BUDGET_MS;
      let sent = 0;
      let failed = 0;
      let released = 0;
      let tasksReminded = 0;
      let tasksRetired = 0;
      let drained = 0;
      for (const t of tenants) {
        // Distribution hold: release imports past their 5-min window (enqueues their digests). Kept in
        // its OWN try so a release failure never blocks that tenant's unrelated pending mail (F-2).
        try {
          released += (await releaseDueImports(db, { tenantId: t.id, portalBaseUrl: env.APP_URL })).released;
        } catch (e) {
          logError("cron_release_tenant_failed", { tenantId: t.id, message: e instanceof Error ? e.message : String(e) });
        }
        try {
          const r = await drainOutbox(db, { tenantId: t.id });
          sent += r.sent;
          failed += r.failed;
          drained += 1;
        } catch (e) {
          // Best-effort per tenant: one tenant's failure must not stop the others.
          logError("cron_drain_tenant_failed", { tenantId: t.id, message: e instanceof Error ? e.message : String(e) });
        }
        // TSK-08: due-task nudges. Same shape as the release duty, in its OWN try so a sweep
        // failure never blocks that tenant's mail. Runs AFTER the drain (audit-tenancy F-3):
        // the sweep is the only unbounded duty here, so a slow or starved one must not delay
        // delivery of already-queued mail or push this job past its check-in — this cron has a
        // false-alarm history (ADR-0032 / the drain-outbox monitor). The cost is that a nudge
        // enqueued now ships on the NEXT tick, which for a once-ever reminder is immaterial.
        try {
          const r = await remindDueTasks(db, { tenantId: t.id, appBaseUrl: env.APP_URL, today, now, deadlineMs: reminderDeadlineMs });
          tasksReminded += r.reminded;
          tasksRetired += r.retired;
        } catch (e) {
          logError("cron_task_reminders_tenant_failed", { tenantId: t.id, message: e instanceof Error ? e.message : String(e) });
        }
      }
      // `tasksReminded` counts tasks CLAIMED by the sweep, not messages delivered: a task whose
      // recipient has both channels switched off is consumed silently, so this number can exceed
      // the mail actually sent. Read it as "due tasks processed", never as a delivery metric.
      // `tasksRetired` (C-14): orphaned tasks retired this run after too many undeliverable ticks.
      return { tenants: drained, released, tasksReminded, tasksRetired, sent, failed };
    },
  ).then(
    (r) => jsonOk({ code: "ok", ...r }),
    // F-3: keep the uniform envelope + one traceId even if the tenant list itself fails.
    (e) => jsonServerError("cron_drain_failed", "Drain failed.", { message: e instanceof Error ? e.message : String(e) }),
  );
}
