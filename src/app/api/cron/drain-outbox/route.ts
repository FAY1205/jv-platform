import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { drainOutbox, releaseDueImports } from "@/modules/notify/outbox";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import * as Sentry from "@sentry/nextjs";
import { CRON_MONITORS, monitorConfig } from "@/lib/cron-monitors";

// F-07: bound the scheduled function's runtime.
export const maxDuration = 60;

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
  return Sentry.withMonitor(
    MONITOR.slug,
    async () => {
      const db = getDb();
      const tenants: { id: string }[] = await db.select({ id: schema.tenants.id }).from(schema.tenants);
      let sent = 0;
      let failed = 0;
      let released = 0;
      let drained = 0;
      for (const t of tenants) {
        // Distribution hold: release imports past their 10-min window (enqueues their digests). Kept in
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
      }
      return { tenants: drained, released, sent, failed };
    },
    monitorConfig(MONITOR),
  ).then(
    (r) => jsonOk({ code: "ok", ...r }),
    // F-3: keep the uniform envelope + one traceId even if the tenant list itself fails.
    (e) => jsonServerError("cron_drain_failed", "Drain failed.", { message: e instanceof Error ? e.message : String(e) }),
  );
}
