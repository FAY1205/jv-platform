import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { updateLeadStatus, LeadNotFoundError, InvalidStatusError } from "@/modules/portal/status-update";
import { notifyStatusChange, drainOutbox } from "@/modules/notify/outbox";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError } from "@/lib/http";

const RefSchema = z.string().regex(/^LD-\d{4}-\d{3,}$/);
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
    const result = await updateLeadStatus(scope, ref, parsed.data.status);

    // NTF-02/04: alert admins (in-app always; email per SET-03, default off). Best-effort.
    try {
      const db = getDb();
      await notifyStatusChange(db, scope, { leadRef: ref, status: parsed.data.status });
      await drainOutbox(db, { tenantId: scope.tenantId });
    } catch (e) {
      logError("status_notify_failed", { message: e instanceof Error ? e.message : String(e) });
    }

    return jsonOk(result);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof InvalidStatusError) return jsonError("invalid_status", e.message, 422);
    return jsonError("status_update_failed", e instanceof Error ? e.message : "Update failed.", 500);
  }
}
