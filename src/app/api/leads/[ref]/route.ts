import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { getAdminLeadDetail } from "@/modules/leads/queries";
import { editLead, LeadNotFoundError, InvalidAssignTargetError } from "@/modules/leads/commands";
import { jsonOk, jsonError } from "@/lib/http";

// ADM: full lead detail for the Leads dialog — includes removed leads, the
// manual-assignment overlay, and the activity timeline. Admin-only; scoped (PRN-08).
export async function GET(_request: Request, { params }: { params: Promise<{ ref: string }> }) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { ref } = await params;
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

const str = (max: number) => z.string().trim().max(max).optional();
const EditSchema = z.object({
  fields: z
    .object({
      sellerFirst: str(120),
      sellerLast: str(120),
      phone: str(40),
      email: str(160),
      address: str(200),
      city: str(120),
      state: z.string().trim().regex(/^[A-Za-z]{0,2}$/).transform((s) => s.toUpperCase()).optional(),
      zip: str(12),
      campaign: str(80),
      reasonForSelling: str(400),
      motivation: str(400),
      timeToSell: str(120),
      notes: str(4000),
    })
    .default({}),
  partner: z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("keep") }),
      z.object({ action: z.literal("set"), partnerId: z.string().uuid() }),
      z.object({ action: z.literal("revert") }),
    ])
    .default({ action: "keep" }),
});

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
    const parsed = EditSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    const result = await editLead(scope, { ref, fields: parsed.data.fields, partner: parsed.data.partner });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof InvalidAssignTargetError) return jsonError("invalid_target", e.message, 400);
    return authErrorResponse(e) ?? jsonError("lead_edit_failed", e instanceof Error ? e.message : "Edit failed.", 500);
  }
}
