import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { unmatchedCount } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// Lightweight unmatched-backlog count for the nav badge. Admin-only (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireCapabilityResponse(scope, "leads.read");
    if (adminOnly) return adminOnly;
    return jsonOk({ count: await unmatchedCount(scope) });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("unmatched_count_failed", "Failed to count unmatched leads", 500);
  }
}
