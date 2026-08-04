import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { leadsCount } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";

// Lightweight total-leads count for the nav badge. Admin-only (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    return jsonOk({ count: await leadsCount(scope) });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("leads_count_failed", "Failed to count leads", 500);
  }
}
