import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { LeadsQuerySchema } from "@/modules/leads/schema";
import { listLeads } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";

// ADM: the global leads list — searchable, filterable, server-paginated.
// Admin-only; scoped via the guard (PRN-08). Params are Zod-normalized
// (invalid filters degrade to defaults instead of erroring).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const query = LeadsQuerySchema.parse(params);
    const page = await listLeads(scope, query);
    return jsonOk(page);
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("leads_list_failed", e instanceof Error ? e.message : "Failed to list leads", 500)
    );
  }
}
