import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listMlsPatterns } from "@/modules/rules/queries";
import { listProfiles } from "@/modules/sources/profile-store";
import { jsonOk, jsonError } from "@/lib/http";

// CVG-02 / SET-12: the Rules area — MLS phrases + the recognized file formats (Source
// Profiles) with template downloads. Coverage moved to Partners (WS-5); recodes removed
// (ADR-0018). File formats move to Settings → Data & Export in WS-7 (SET-12).
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const [mlsPatterns, formats] = await Promise.all([
      listMlsPatterns(scope),
      listProfiles(getDb(), scope),
    ]);
    return jsonOk({ mlsPatterns, formats });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("rules_failed", "Could not load rules.", 500);
  }
}
