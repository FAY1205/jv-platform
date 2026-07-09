import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import {
  updateLeadStatus,
  LeadNotFoundError,
  InvalidStatusError,
  LeadRemovedError,
} from "@/modules/portal/status-update";
import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";
import { jsonOk, jsonError } from "@/lib/http";

const RefSchema = z.string().regex(/^LD-\d{4}-\d{3,}$/);
const Input = z.object({ status: z.enum(SEED_LEAD_STATUSES) });

// ADM: inline status change from the global Leads table. Admin-only; CSRF-guarded.
// Appends status history + event (PRN-05: the assignment snapshot is untouched).
// Removed-from-MLS leads are read-only (PRN-04) — refused with 409.
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A valid status is required.", 400);

  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const result = await updateLeadStatus(scope, ref, parsed.data.status);
    return jsonOk(result);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof LeadRemovedError) return jsonError("lead_removed", e.message, 409);
    if (e instanceof InvalidStatusError) return jsonError("invalid_status", e.message, 422);
    return jsonError("status_update_failed", e instanceof Error ? e.message : "Update failed.", 500);
  }
}
