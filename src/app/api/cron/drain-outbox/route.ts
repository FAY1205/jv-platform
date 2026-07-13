import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { drainOutbox, releaseDueImports } from "@/modules/notify/outbox";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";

// F-07: bound the scheduled function's runtime.
export const maxDuration = 60;

// GET /api/cron/drain-outbox — scheduled outbox drain (Vercel Cron, vercel.json).
// Authorized by the CRON_SECRET bearer, NOT a session/CSRF. Drains EACH tenant's outbox
// (every drainOutbox call is tenant-scoped — PRN-08; the only cross-tenant read is the
// tenant-id list, a system operation). Non-production sends to the email sink (SEC-07).
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return jsonError("unauthorized", "Authentication required.", 401);
  }
  const db = getDb();
  let tenants: { id: string }[];
  try {
    tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  } catch (e) {
    // F-3: keep the uniform envelope + one traceId even if the tenant list itself fails.
    return jsonServerError("cron_drain_failed", "Drain failed.", { message: e instanceof Error ? e.message : String(e) });
  }
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
  return jsonOk({ code: "ok", tenants: drained, released, sent, failed });
}
