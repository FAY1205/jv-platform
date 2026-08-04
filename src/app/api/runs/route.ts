import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listRunsPage } from "@/modules/run/queries";
import { pageParam, pageSizeParam, dateParam } from "@/lib/query-params";
import { jsonOk, jsonError } from "@/lib/http";

// T4: server-side paginated + processed-date-filtered imports list (FEP-03).
// Params are graceful (invalid values degrade to defaults, never 400/500) — all
// via the shared query-param primitives (one canonical boundary).

export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const sp = new URL(request.url).searchParams;
    const result = await listRunsPage(scope, {
      page: pageParam().parse(sp.get("page")),
      pageSize: pageSizeParam().parse(sp.get("pageSize")),
      dateFrom: dateParam().parse(sp.get("dateFrom")),
      dateTo: dateParam().parse(sp.get("dateTo")),
    });
    return jsonOk(result);
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("runs_list_failed", e instanceof Error ? e.message : "Failed to list runs", 500)
    );
  }
}
