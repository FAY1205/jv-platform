import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { dashboardData } from "@/modules/analytics/queries";
import { RANGE_KEYS, type RangeKey } from "@/modules/analytics/ranges";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

const RangeSchema = z.enum(RANGE_KEYS as unknown as [RangeKey, ...RangeKey[]]).catch("30d");

// The unified dashboard payload (ANA-01/02). Admin-only; scoped via the guard
// (PRN-08). Unknown/invalid ?range= degrades to "30d".
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.read");
    if (gate) return gate;
    const range = RangeSchema.parse(new URL(request.url).searchParams.get("range"));
    return jsonOk(await dashboardData(scope, range));
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("dashboard_failed", e instanceof Error ? e.message : "Failed to load dashboard", 500);
  }
}
