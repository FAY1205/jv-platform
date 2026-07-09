import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { dashboardData } from "@/modules/analytics/queries";
import type { Period } from "@/modules/analytics/periods";
import { jsonOk, jsonError } from "@/lib/http";

const PERIODS: readonly Period[] = ["week", "month", "year", "all"];

// The unified dashboard payload (ANA-01/02). Admin-only; scoped via the guard
// (PRN-08). Unknown ?period= degrades to "week".
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const raw = new URL(request.url).searchParams.get("period");
    const period: Period = PERIODS.includes(raw as Period) ? (raw as Period) : "week";
    return jsonOk(await dashboardData(scope, period));
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("dashboard_failed", e instanceof Error ? e.message : "Failed to load dashboard", 500);
  }
}
