import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { getPartnerLeadDetail } from "@/modules/portal/queries";
import { jsonOk, jsonError } from "@/lib/http";

const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);

// GET /api/portal/leads/[ref] — one owned lead + its status history (PTL-02/03).
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  try {
    const scope = await getServerScope();
    const detail = await getPartnerLeadDetail(scope, ref);
    if (!detail) return jsonError("not_found", `Lead ${ref} not found.`, 404);
    return jsonOk(detail);
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("lead_detail_failed", e instanceof Error ? e.message : "Failed to load lead.", 500);
  }
}
