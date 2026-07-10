import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listAdminActivity, listActivityActors } from "@/modules/activity/queries";
import { ActivityQuerySchema } from "@/modules/activity/schema";
import { jsonOk, jsonError } from "@/lib/http";

// ACT-01/04: the tenant's audit trail (admin only). Server-side filtered (category, actor,
// date range, search) + sorted + paginated; `actors` powers the filter dropdown.
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const query = ActivityQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const [pageData, actors] = await Promise.all([listAdminActivity(scope, query), listActivityActors(scope)]);
    return jsonOk({ ...pageData, actors });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("activity_failed", "Could not load activity.", 500);
  }
}
