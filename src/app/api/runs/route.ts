import { getServerScope } from "@/lib/scope-context";
import { listRuns } from "@/modules/run/queries";
import { jsonOk, jsonError } from "@/lib/http";

export async function GET() {
  try {
    const scope = await getServerScope();
    const runs = await listRuns(scope);
    return jsonOk({ runs });
  } catch (e) {
    return jsonError("runs_list_failed", e instanceof Error ? e.message : "Failed to list runs", 500);
  }
}
