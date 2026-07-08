import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listRuns } from "@/modules/run/queries";
import { jsonOk, jsonError } from "@/lib/http";

export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const runs = await listRuns(scope);
    return jsonOk({ runs });
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("runs_list_failed", e instanceof Error ? e.message : "Failed to list runs", 500)
    );
  }
}
