import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listRecodes, listMlsPatterns, coverageSummary } from "@/modules/rules/queries";
import { jsonOk, jsonError } from "@/lib/http";

// CVG-02: the unified Rules area — recodes, MLS phrases, and a coverage summary.
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const [recodes, mlsPatterns, coverage] = await Promise.all([
      listRecodes(scope),
      listMlsPatterns(scope),
      coverageSummary(scope),
    ]);
    return jsonOk({ recodes, mlsPatterns, coverage });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("rules_failed", "Could not load rules.", 500);
  }
}
