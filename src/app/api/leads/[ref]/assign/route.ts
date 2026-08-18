import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import {
  manuallyAssignLead,
  LeadNotFoundError,
  LeadNotUnmatchedError,
  InvalidAssignTargetError,
} from "@/modules/leads/commands";
import { notifyLeadAssigned } from "@/modules/notify/outbox";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);
const BodySchema = z.object({
  partnerId: z.string().uuid(),
});

// ASN-03: manually assign an unmatched lead to a partner. Admin-only; CSRF-guarded;
// scoped + audited in the command.
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.write");
    if (gate) return gate;
    const { ref } = await params;
    if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    const result = await manuallyAssignLead(scope, { leadRef: ref, partnerId: parsed.data.partnerId });
    // F-40: tell the receiving partner (best-effort, in-app; ADR-0020 / ADR-0014).
    // audit-tenancy (WP-NF1): address the fan-out by the SERVER-VALIDATED id the command
    // returned, never the request body — the fan-out is now org-wide and includes email.
    try {
      await notifyLeadAssigned(getDb(), scope, { leadRef: ref, partnerId: result.assignedPartnerId });
    } catch (e) {
      logError("assign_notify_failed", { message: e instanceof Error ? e.message : String(e) });
    }
    return jsonOk({ code: "ok", message: `Lead assigned to ${result.partnerRefId}.` });
  } catch (e) {
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof LeadNotUnmatchedError) return jsonError("not_unmatched", e.message, 409);
    if (e instanceof InvalidAssignTargetError) return jsonError("invalid_target", e.message, 400);
    return authErrorResponse(e) ?? jsonServerError("assign_failed", "Could not assign the lead.", { message: e instanceof Error ? e.message : String(e) });
  }
}
