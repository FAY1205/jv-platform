import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import { drainOutbox } from "@/modules/notify/outbox";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// NTF-03: drain pending outbound emails (send + retry with backoff). Admin-only;
// also the hook a scheduled job (cron) will call. Scoped to the caller's tenant.
export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "ops.admin");
    if (gate) return gate;
    const result = await drainOutbox(getDb(), { tenantId: scope.tenantId });
    return jsonOk({ code: "ok", message: "Outbox drained.", result });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("drain_failed", "Could not drain the outbox.", 500);
  }
}
