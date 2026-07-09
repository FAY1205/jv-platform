import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { analyticsOverview } from "@/modules/analytics/queries";
import { jsonOk, jsonError } from "@/lib/http";

// ANA-01: analytics overview. Admin-only; scoped via the guard (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const data = await analyticsOverview(scope);
    return jsonOk(data);
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("analytics_failed", e instanceof Error ? e.message : "Failed to load analytics", 500)
    );
  }
}
