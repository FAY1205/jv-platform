import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { partnerPerformanceDetail } from "@/modules/analytics/partner-performance";
import { RANGE_KEYS, type RangeKey } from "@/modules/analytics/ranges";
import { jsonOk, jsonError } from "@/lib/http";

const IdSchema = z.string().uuid();
const RangeSchema = z.enum(RANGE_KEYS as unknown as [RangeKey, ...RangeKey[]]).catch("12mo");

// ADM-03 / ANA-02: a single partner's performance over a rolling range (given /
// contacted / closed + Avg Contact + history). Admin-only; scoped via the guard (PRN-08).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);
    const range = RangeSchema.parse(new URL(request.url).searchParams.get("range"));
    return jsonOk(await partnerPerformanceDetail(scope, id, range));
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("partner_perf_failed", e instanceof Error ? e.message : "Failed to load partner performance", 500);
  }
}
