import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { getPartner } from "@/modules/partners/queries";
import { updatePartner, PartnerNotFoundError } from "@/modules/partners/commands";
import { PartnerUpdateSchema } from "@/modules/partners/schema";
import { jsonOk, jsonError } from "@/lib/http";

const IdSchema = z.string().uuid();

// ADM-03: a single partner (with current territory) + contact-detail edit.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);
    const partner = await getPartner(scope, id);
    if (!partner) return jsonError("not_found", "Partner not found.", 404);
    return jsonOk({ partner });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("partner_get_failed", "Could not load the partner.", 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);

    const parsed = PartnerUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    await updatePartner(scope, id, parsed.data);
    return jsonOk({ code: "ok", message: "Partner updated." });
  } catch (e) {
    if (e instanceof PartnerNotFoundError) return jsonError("not_found", e.message, 404);
    return authErrorResponse(e) ?? jsonError("partner_update_failed", "Could not update the partner.", 500);
  }
}
