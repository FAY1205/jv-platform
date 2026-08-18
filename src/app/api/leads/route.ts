import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { LeadsQuerySchema } from "@/modules/leads/schema";
import { listLeads } from "@/modules/leads/queries";
import { jsonOk, jsonServerError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// ADM: the global leads list — searchable, filterable, server-paginated.
// Admin-only; scoped via the guard (PRN-08). Params are Zod-normalized
// (invalid filters degrade to defaults instead of erroring).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireCapabilityResponse(scope, "leads.read");
    if (adminOnly) return adminOnly;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const query = LeadsQuerySchema.parse(params);
    const page = await listLeads(scope, query);
    return jsonOk(page);
  } catch (e) {
    // C-17: static message + logged traceId — never echo the driver error (its bound
    // params can carry seller data) to the client.
    return (
      authErrorResponse(e) ??
      jsonServerError("leads_list_failed", "Failed to list leads.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
