import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { recentLeadsForPartner } from "@/modules/partners/queries";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

const IdSchema = z.string().uuid();

// ADM-03: a partner's recent kept leads (admin lead history). Scoped via the
// guard (PRN-08); admin-only.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "partners.manage");
    if (gate) return gate;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);
    const leads = await recentLeadsForPartner(scope, id);
    return jsonOk({ leads });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("partner_leads_failed", "Could not load the partner's leads.", 500);
  }
}
