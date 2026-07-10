import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listPartnerActivity } from "@/modules/activity/queries";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";

// ACT-02: a partner's own actions on their own leads (status updates + notes).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    if (scope.role !== "partner") return jsonError("forbidden", "Partner only.", 403);
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data on ToS acceptance
    if (tos) return tos;
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    return jsonOk(await listPartnerActivity(scope, page));
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("activity_failed", "Could not load activity.", { message: e instanceof Error ? e.message : String(e) });
  }
}
