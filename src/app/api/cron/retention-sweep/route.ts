import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { sweepTenantPii } from "@/modules/retention/sweep";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";

// WP-GL-B: bound the scheduled function's runtime.
export const maxDuration = 60;

// GET /api/cron/retention-sweep — scheduled PII purge of soft-deleted leads past the grace
// window (DM-09 / LGL-02). Authorized by the CRON_SECRET bearer, NOT a session/CSRF. Each
// sweepTenantPii call is tenant-scoped (PRN-08); the only cross-tenant read is the tenant-id
// list — a system operation, exactly like the outbox drain.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return jsonError("unauthorized", "Authentication required.", 401);
  }
  const db = getDb();
  let tenants: { id: string }[];
  try {
    tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  } catch (e) {
    return jsonServerError("cron_retention_failed", "Retention sweep failed.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
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
  return jsonOk({ code: "ok", tenants: swept, purged });
}
