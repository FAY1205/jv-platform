import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { periodSummary } from "@/modules/analytics/queries";
import type { Period } from "@/modules/analytics/periods";
import { jsonOk, jsonError } from "@/lib/http";

const PERIODS: readonly Period[] = ["week", "month", "year", "all"];

// ANA-01: dashboard period KPIs. Admin-only; scoped via the guard (PRN-08).
// An unknown ?period= degrades to "week" rather than erroring.
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const raw = new URL(request.url).searchParams.get("period");
    const period: Period = PERIODS.includes(raw as Period) ? (raw as Period) : "week";
    const summary = await periodSummary(scope, period);
    return jsonOk(summary);
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("analytics_period_failed", e instanceof Error ? e.message : "Failed to load period summary", 500)
    );
  }
}
