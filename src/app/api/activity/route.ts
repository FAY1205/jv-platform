import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listAdminActivity } from "@/modules/activity/queries";
import { jsonOk, jsonError } from "@/lib/http";

// ACT-01/04: the tenant's audit trail (admin only). Newest first, paginated.
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    return jsonOk(await listAdminActivity(scope, page));
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("activity_failed", "Could not load activity.", 500);
  }
}
