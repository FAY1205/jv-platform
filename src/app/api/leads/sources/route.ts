import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listLeadSources } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";

// ADM: distinct lead sources (campaigns) for the Leads filter dropdown.
// Admin-only; tenant-scoped through the guard (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const sources = await listLeadSources(scope);
    return jsonOk({ sources });
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("lead_sources_failed", e instanceof Error ? e.message : "Failed to list sources", 500)
    );
  }
}
