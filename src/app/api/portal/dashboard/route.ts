import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { z } from "zod";
import { partnerDashboardStats } from "@/modules/portal/queries";
import { RANGE_KEYS, type RangeKey } from "@/modules/analytics/ranges";
import { jsonOk, jsonServerError } from "@/lib/http";
import { requirePassthroughResponse } from "@/lib/authz";

const RangeSchema = z.enum(RANGE_KEYS as unknown as [RangeKey, ...RangeKey[]]).catch("30d");

// GET /api/portal/dashboard?range=<RangeKey> — the caller's own KPIs (PTL, PRN-08).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    // ADR-0047 Phase C: partners pass on scope alone; an ADMIN-STREAM caller reaches
    // tenant-wide data through this partner-shaped code, so it must hold leads.read.
    const gate = requirePassthroughResponse(scope, "leads.read");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data on ToS acceptance
    if (tos) return tos;
    const range = RangeSchema.parse(new URL(request.url).searchParams.get("range"));
    return jsonOk(await partnerDashboardStats(scope, range));
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("portal_dashboard_failed", "Failed to load your dashboard.", { message: e instanceof Error ? e.message : String(e) });
  }
}
