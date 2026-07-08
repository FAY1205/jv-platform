import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { listPartnerActivity } from "@/modules/activity/queries";
import { jsonOk, jsonError } from "@/lib/http";

// ACT-02: a partner's own actions on their own leads (status updates + notes).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    if (scope.role !== "partner") return jsonError("forbidden", "Partner only.", 403);
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    return jsonOk(await listPartnerActivity(scope, page));
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("activity_failed", "Could not load activity.", 500);
  }
}
