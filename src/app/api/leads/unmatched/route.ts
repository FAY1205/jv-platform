import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { unmatchedStateStats } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";

// ASN-03: the unmatched inbox's per-state stats + total (bounded, F-11). The lead
// rows themselves come from the paginated /api/leads?partnerId=unmatched. Admin-only;
// scoped via the guard (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    return jsonOk(await unmatchedStateStats(scope));
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("unmatched_stats_failed", e instanceof Error ? e.message : "Failed to load unmatched stats", 500);
  }
}
