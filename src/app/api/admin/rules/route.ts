import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { listMlsPatterns } from "@/modules/rules/queries";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// CVG-02: the Rules area — MLS phrases only. Coverage moved to Partners (WS-5); recodes
// removed (ADR-0018); file formats (Source Profiles, SET-12) moved to Settings → Data &
// Export (WS-7g). The page is now truly MLS-only.
export async function GET() {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "rules.manage");
    if (gate) return gate;
    const mlsPatterns = await listMlsPatterns(scope);
    return jsonOk({ mlsPatterns });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("rules_failed", "Could not load rules.", 500);
  }
}
