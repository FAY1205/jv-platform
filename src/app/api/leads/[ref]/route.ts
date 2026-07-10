import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { getAdminLeadDetail } from "@/modules/leads/queries";
import { editLead, LeadNotFoundError, InvalidAssignTargetError, CannotUnassignRoutedLeadError } from "@/modules/leads/commands";
import { EditLeadSchema } from "@/modules/leads/schema";
import { jsonOk, jsonError } from "@/lib/http";

// Lead ref format (v2, ADR-0019). Sibling routes validate this before touching the DB (F-13).
const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);

// ADM: full lead detail for the Leads dialog — includes removed leads, the
// manual-assignment overlay, and the activity timeline. Admin-only; scoped (PRN-08).
export async function GET(_request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { ref } = await params;
    if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
    const detail = await getAdminLeadDetail(scope, ref);
    if (!detail) return jsonError("not_found", "Lead not found.", 404);
    return jsonOk(detail);
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("lead_detail_failed", e instanceof Error ? e.message : "Failed to load lead", 500)
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
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { ref } = await params;
    if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
    const parsed = EditLeadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    const result = await editLead(scope, { ref, fields: parsed.data.fields, partner: parsed.data.partner });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof InvalidAssignTargetError) return jsonError("invalid_target", e.message, 400);
    if (e instanceof CannotUnassignRoutedLeadError) return jsonError("cannot_unassign", e.message, 409);
    return authErrorResponse(e) ?? jsonError("lead_edit_failed", e instanceof Error ? e.message : "Edit failed.", 500);
  }
}
