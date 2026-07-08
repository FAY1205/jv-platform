import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listRecodes, listMlsPatterns, coverageSummary } from "@/modules/rules/queries";
import { listProfiles } from "@/modules/sources/profile-store";
import { jsonOk, jsonError } from "@/lib/http";

// CVG-02 / SET-12: the unified Rules area — recodes, MLS phrases, coverage summary,
// and the recognized file formats (Source Profiles) with template downloads.
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const [recodes, mlsPatterns, coverage, formats] = await Promise.all([
      listRecodes(scope),
      listMlsPatterns(scope),
      coverageSummary(scope),
      listProfiles(getDb(), scope),
    ]);
    return jsonOk({ recodes, mlsPatterns, coverage, formats });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("rules_failed", "Could not load rules.", 500);
  }
}
