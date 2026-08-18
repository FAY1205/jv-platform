import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { jsonOk, jsonServerError } from "@/lib/http";
import { listTeam } from "@/modules/team/team";

// Phase C: the Team roster — staff seats + open invites (TM-01). team.manage is
// ADMIN-LOCKED (ADR-0049), so member/viewer 403 here and the settings nav hides the page.
export async function GET() {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "team.manage");
    if (gate) return gate;
    return jsonOk(await listTeam(getDb(), scope));
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonServerError("team_failed", "Could not load your team.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
