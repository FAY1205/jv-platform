import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listMlsPatterns, coverageSummary } from "@/modules/rules/queries";
import { listProfiles } from "@/modules/sources/profile-store";
import { jsonOk, jsonError } from "@/lib/http";

// CVG-02 / SET-12: the unified Rules area — MLS phrases, coverage summary, and the
// recognized file formats (Source Profiles) with template downloads. (Campaign
// recodes removed, ADR-0018.)
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const [mlsPatterns, coverage, formats] = await Promise.all([
      listMlsPatterns(scope),
      coverageSummary(scope),
      listProfiles(getDb(), scope),
    ]);
    return jsonOk({ mlsPatterns, coverage, formats });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("rules_failed", "Could not load rules.", 500);
  }
}
