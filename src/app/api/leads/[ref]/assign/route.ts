import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import {
  manuallyAssignLead,
  LeadNotFoundError,
  LeadNotUnmatchedError,
  InvalidAssignTargetError,
} from "@/modules/leads/commands";
import { jsonOk, jsonError } from "@/lib/http";

const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);
const BodySchema = z.object({
  partnerId: z.string().uuid(),
  reason: z.string().trim().max(280).optional(),
});

// ASN-03: manually assign an unmatched lead to a partner. Admin-only; CSRF-guarded;
// scoped + audited in the command.
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { ref } = await params;
    if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    const result = await manuallyAssignLead(scope, { leadRef: ref, partnerId: parsed.data.partnerId, reason: parsed.data.reason });
    return jsonOk({ code: "ok", message: `Lead assigned to ${result.partnerRefId}.` });
  } catch (e) {
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof LeadNotUnmatchedError) return jsonError("not_unmatched", e.message, 409);
    if (e instanceof InvalidAssignTargetError) return jsonError("invalid_target", e.message, 400);
    return authErrorResponse(e) ?? jsonError("assign_failed", "Could not assign the lead.", 500);
  }
}
