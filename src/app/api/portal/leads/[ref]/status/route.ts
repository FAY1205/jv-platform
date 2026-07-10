import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { updateLeadStatus, LeadNotFoundError, InvalidStatusError, LeadRemovedError } from "@/modules/portal/status-update";
import { notifyStatusChange, drainOutbox } from "@/modules/notify/outbox";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";

const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);
const Input = z.object({ status: z.string().min(1).max(50) });

// POST /api/portal/leads/[ref]/status — update an owned lead's status (PTL-03).
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A status is required.", 400);

  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data writes on ToS acceptance
    if (tos) return tos;
    const result = await updateLeadStatus(scope, ref, parsed.data.status);

    // NTF-02/04: alert admins (in-app always; email per SET-03, default off). Best-effort.
    // F-12: skip entirely on a no-op update so a repeated same-status POST never
    // re-notifies admins (the command already skipped the history/event writes).
    if (result.changed) {
      try {
        const db = getDb();
        await notifyStatusChange(db, scope, { leadRef: ref, status: parsed.data.status });
        await drainOutbox(db, { tenantId: scope.tenantId });
      } catch (e) {
        logError("status_notify_failed", { message: e instanceof Error ? e.message : String(e) });
      }
    }

    return jsonOk({ refId: result.refId, status: result.status });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof LeadRemovedError) return jsonError("lead_removed", e.message, 409);
    if (e instanceof InvalidStatusError) return jsonError("invalid_status", e.message, 422);
    return jsonServerError("status_update_failed", "Update failed.", { message: e instanceof Error ? e.message : String(e) });
  }
}
