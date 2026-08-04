import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { countPartnerLeads } from "@/modules/portal/queries";
import { jsonOk, jsonServerError } from "@/lib/http";

// T7a: the shell nav badge — the partner's total visible leads (identical semantics to
// the unfiltered /api/portal/leads count, PTL-02). Scoped via countPartnerLeads (PRN-08)
// and ToS-gated like every portal data route (F-04).
export async function GET() {
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    return jsonOk({ count: await countPartnerLeads(scope) });
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("leads_count_failed", "Failed to load the lead count.", { message: e instanceof Error ? e.message : String(e) });
  }
}
