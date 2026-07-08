import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { updateLeadStatus, LeadNotFoundError, InvalidStatusError } from "@/modules/portal/status-update";
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
    return jsonOk(await updateLeadStatus(scope, ref, parsed.data.status));
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof InvalidStatusError) return jsonError("invalid_status", e.message, 422);
    return jsonError("status_update_failed", e instanceof Error ? e.message : "Update failed.", 500);
  }
}
