import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { sweepTenantPii } from "@/modules/retention/sweep";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import * as Sentry from "@sentry/nextjs";
import { CRON_MONITORS, monitorConfig } from "@/lib/cron-monitors";

// WP-GL-B: bound the scheduled function's runtime.
export const maxDuration = 60;

// ACT-05 (ADR-0032): this job's Sentry check-in identity + schedule. This is the sweep
// that discharges the LGL-02 deletion promise — its silent death is the one that matters.
const MONITOR = CRON_MONITORS["/api/cron/retention-sweep"];

// GET /api/cron/retention-sweep — scheduled PII purge of soft-deleted leads past the grace
// window (DM-09 / LGL-02). Authorized by the CRON_SECRET bearer, NOT a session/CSRF. Each
// sweepTenantPii call is tenant-scoped (PRN-08); the only cross-tenant read is the tenant-id
// list — a system operation, exactly like the outbox drain.
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
  // here would report a sweep that purged NOTHING as healthy — a green dashboard over an
  // undischarged LGL-02 deletion promise. The rejection handler below restores the envelope.
  return Sentry.withMonitor(
    MONITOR.slug,
    async () => {
      const db = getDb();
      const tenants: { id: string }[] = await db.select({ id: schema.tenants.id }).from(schema.tenants);
      let purged = 0;
      let swept = 0;
      for (const t of tenants) {
        try {
          const r = await sweepTenantPii(db, { tenantId: t.id });
          purged += r.purged;
          swept += 1;
        } catch (e) {
          // Best-effort per tenant: one tenant's failure must not stop the others.
          logError("cron_retention_tenant_failed", { tenantId: t.id, message: e instanceof Error ? e.message : String(e) });
        }
      }
      return { tenants: swept, purged };
    },
    monitorConfig(MONITOR),
  ).then(
    (r) => jsonOk({ code: "ok", ...r }),
    (e) =>
      jsonServerError("cron_retention_failed", "Retention sweep failed.", {
        message: e instanceof Error ? e.message : String(e),
      }),
  );
}
