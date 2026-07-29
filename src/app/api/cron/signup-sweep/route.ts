import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { sweepAbandonedSignups, reconcileDroppedSignups } from "@/modules/retention/signup-sweep";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import * as Sentry from "@sentry/nextjs";
import { CRON_MONITORS, monitorConfig } from "@/lib/cron-monitors";

// WP-SU-2: bound the scheduled function's runtime (mirrors retention-sweep).
export const maxDuration = 60;

// ACT-05 (ADR-0032): this job's Sentry check-in identity + schedule.
const MONITOR = CRON_MONITORS["/api/cron/signup-sweep"];

// A per-tenant purge whose tenants delete is FK-blocked surfaces as Postgres 23503. drizzle
// (0.45) wraps the driver error in DrizzleQueryError with the postgres-js error on `.cause`,
// so walk the cause chain defensively rather than reading `.code` off the top-level error.
function pgErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 5; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

// GET /api/cron/signup-sweep — scheduled cleanup of abandoned public signups (WP-SU-2,
// ADR-0033's WP-SU-1 note). Authorized by the CRON_SECRET bearer, NOT a session/CSRF.
// Two passes covering the three failure shapes (see signup-sweep.ts): sweepAbandonedSignups
// purges each tenant's provably-abandoned signup (PRN-08: tenant-scoped); reconcileDroppedSignups
// then catches BOTH remaining shapes from one auth-user scan — partial provisions (users row but
// no verification row) and after()-dropped orphans (no tenant at all). That merged pass is a
// cross-tenant system op (the same documented exemption as the tenant-id list below and
// emailExistsGlobally).
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return jsonError("unauthorized", "Authentication required.", 401);
  }
  // ACT-05: check in with Sentry around the real work, so a run that never happens is
  // itself an alert. See retention-sweep/route.ts for why the tenant-list failure THROWS
  // rather than returning an error response from inside the callback.
  return Sentry.withMonitor(
    MONITOR.slug,
    async () => {
      const db = getDb();
      const admin = getSupabaseAdmin();
      const tenants: { id: string }[] = await db.select({ id: schema.tenants.id }).from(schema.tenants);
      let purged = 0;
      let skipped = 0;
      let swept = 0;
      for (const t of tenants) {
        try {
          const r = await sweepAbandonedSignups(db, admin, { tenantId: t.id });
          purged += r.purged;
          skipped += r.skipped;
          swept += 1;
        } catch (e) {
          // Best-effort per tenant: one tenant's failure must not stop the others. A tenants
          // delete FK-blocked by an unexpected residual row (23503) is a DISTINCT, actionable
          // signal — the conservative stop item F's action-scoped audit purge deliberately
          // preserves — so it gets its own code (item G).
          const code = pgErrorCode(e) === "23503" ? "cron_signup_sweep_tenant_fk_blocked" : "cron_signup_sweep_tenant_failed";
          logError(code, { tenantId: t.id, message: e instanceof Error ? e.message : String(e) });
        }
      }
      // The reconciliation pass below runs OUTSIDE the per-tenant try: its throw is
      // INTENTIONALLY not caught, so a broken dropped-signup pass FAILS the Sentry check-in
      // (item L1). Unlike a single tenant's best-effort failure above, a reconciliation pass
      // that can't run means dropped/abandoned signups accumulate unseen — the exact silence
      // this WP exists to break, so it must surface as a failed job, not a green 500.
      const reconciled = await reconcileDroppedSignups(db, admin, {});
      return { tenants: swept, purged, skipped, orphans: reconciled.orphans, partials: reconciled.partials };
    },
    monitorConfig(MONITOR),
  ).then(
    (r) => jsonOk({ code: "ok", ...r }),
    (e) =>
      jsonServerError("cron_signup_sweep_failed", "Signup sweep failed.", {
        message: e instanceof Error ? e.message : String(e),
      }),
  );
}
