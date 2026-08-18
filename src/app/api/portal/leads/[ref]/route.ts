import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { getPartnerLeadDetail } from "@/modules/portal/queries";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { requirePassthroughResponse } from "@/lib/authz";

const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);

// GET /api/portal/leads/[ref] — one owned lead + its status history (PTL-02/03).
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  try {
    const scope = await getServerScope();
    // ADR-0047 Phase C: partners pass on scope alone; an ADMIN-STREAM caller reaches
    // tenant-wide data through this partner-shaped code, so it must hold leads.read.
    const gate = requirePassthroughResponse(scope, "leads.read");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data on ToS acceptance
    if (tos) return tos;
    const detail = await getPartnerLeadDetail(scope, ref);
    if (!detail) return jsonError("not_found", `Lead ${ref} not found.`, 404);
    return jsonOk(detail);
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("lead_detail_failed", "Failed to load lead.", { message: e instanceof Error ? e.message : String(e) });
  }
}
