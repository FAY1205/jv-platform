import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { coverageMapData } from "@/modules/coverage/queries";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// MAP-01: read-only coverage map data. Admin-only; scoped via the guard (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.read");
    if (gate) return gate;
    const data = await coverageMapData(scope);
    return jsonOk(data);
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("coverage_map_failed", e instanceof Error ? e.message : "Failed to load coverage map", 500)
    );
  }
}
