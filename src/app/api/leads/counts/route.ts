import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { leadNavCounts } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// C-41d: the ONE lightweight nav-badge count endpoint → { total, unmatched }. Replaces the
// pair /api/leads/count + /api/leads/unmatched/count, which the shell fired together on every
// admin page — same table, same tenant predicate, same leads.read gate, two scope resolutions.
// Admin-only (PRN-08); one SQL round trip (leadNavCounts).
export async function GET() {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.read");
    if (gate) return gate;
    return jsonOk(await leadNavCounts(scope));
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("leads_counts_failed", "Failed to count leads", 500);
  }
}
