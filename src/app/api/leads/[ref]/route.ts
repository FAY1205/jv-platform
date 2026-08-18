import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { getAdminLeadDetail } from "@/modules/leads/queries";
import { editLead, LeadNotFoundError, InvalidAssignTargetError, CannotUnassignRoutedLeadError } from "@/modules/leads/commands";
import { notifyLeadAssigned } from "@/modules/notify/outbox";
import { EditLeadSchema } from "@/modules/leads/schema";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// Lead ref format (v2, ADR-0019). Sibling routes validate this before touching the DB (F-13).
const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);

// ADM: full lead detail for the Leads dialog — includes removed leads, the
// manual-assignment overlay, and the activity timeline. Admin-only; scoped (PRN-08).
export async function GET(_request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.read");
    if (gate) return gate;
    const { ref } = await params;
    if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
    const detail = await getAdminLeadDetail(scope, ref);
    if (!detail) return jsonError("not_found", "Lead not found.", 404);
    return jsonOk(detail);
  } catch (e) {
    // C-17: static message + logged traceId — never echo the driver error to the client.
    return (
      authErrorResponse(e) ??
      jsonServerError("lead_detail_failed", "Failed to load lead.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}

// PATCH /api/leads/[ref] — edit a lead's canonical fields + optionally re-route the
// effective owner (PRN-05-safe overlay). Admin-only; CSRF-guarded; audited.
export async function PATCH(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.write");
    if (gate) return gate;
    const { ref } = await params;
    if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
    const parsed = EditLeadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    const result = await editLead(scope, { ref, fields: parsed.data.fields, partner: parsed.data.partner });
    // F-40: if the edit re-routed the lead to a partner, tell them (best-effort, in-app).
    if (result.assignedPartnerId) {
      try {
        await notifyLeadAssigned(getDb(), scope, { leadRef: ref, partnerId: result.assignedPartnerId });
      } catch (e) {
        logError("assign_notify_failed", { message: e instanceof Error ? e.message : String(e) });
      }
    }
    return jsonOk({ refId: result.refId });
  } catch (e) {
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof InvalidAssignTargetError) return jsonError("invalid_target", e.message, 400);
    if (e instanceof CannotUnassignRoutedLeadError) return jsonError("cannot_unassign", e.message, 409);
    return authErrorResponse(e) ?? jsonServerError("lead_edit_failed", "Edit failed.", { message: e instanceof Error ? e.message : String(e) });
  }
}
