import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listPartnerActivity } from "@/modules/activity/queries";
import { pageParam, pageSizeParam, PORTAL_MAX_PAGE } from "@/lib/query-params";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";

// Built once (portal ceiling); admin schemas build their page field the same way.
const portalPageSchema = pageParam({ max: PORTAL_MAX_PAGE });
const portalPageSizeSchema = pageSizeParam();

// WP-PP-5: only apply the parsed pageSize when the caller actually sent one, so the
// no-param path keeps listPartnerActivity's own default (mirrors the portal leads route).
function parsePageSize(v: string | null): number | undefined {
  return v == null ? undefined : portalPageSizeSchema.parse(v);
}

// ACT-02: a partner's own actions on their own leads (status updates + notes).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    if (scope.role !== "partner") return jsonError("forbidden", "Partner only.", 403);
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data on ToS acceptance
    if (tos) return tos;
    const params = new URL(request.url).searchParams;
    const page = portalPageSchema.parse(params.get("page"));
    return jsonOk(await listPartnerActivity(scope, { page, pageSize: parsePageSize(params.get("pageSize")) }));
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("activity_failed", "Could not load activity.", { message: e instanceof Error ? e.message : String(e) });
  }
}
