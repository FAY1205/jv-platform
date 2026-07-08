import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { listPartners } from "@/modules/partners/queries";
import { createPartner } from "@/modules/partners/commands";
import { PartnerCreateSchema } from "@/modules/partners/schema";
import { jsonOk, jsonError } from "@/lib/http";

// ADM-03 partner roster. Admin-only; reads/writes go through the scope guard.
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    return jsonOk({ partners: await listPartners(scope) });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("partners_list_failed", "Could not load partners.", 500);
  }
}

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;

    const parsed = PartnerCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    const created = await createPartner(scope, parsed.data);
    return jsonOk({ code: "ok", message: "Partner created.", partner: created });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("partner_create_failed", "Could not create the partner.", 500);
  }
}
