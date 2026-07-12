import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listPartnerLeads } from "@/modules/portal/queries";
import { pageParam, PORTAL_MAX_PAGE } from "@/lib/query-params";
import { jsonOk, jsonServerError } from "@/lib/http";

// Built once (portal ceiling); admin schemas build their page field the same way.
const portalPageSchema = pageParam({ max: PORTAL_MAX_PAGE });

// GET /api/portal/leads?page=N — the caller's own leads, server-side paginated (PTL-02, FEP-03).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data on ToS acceptance
    if (tos) return tos;
    const page = portalPageSchema.parse(new URL(request.url).searchParams.get("page"));
    return jsonOk(await listPartnerLeads(scope, page));
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("leads_failed", "Failed to load leads.", { message: e instanceof Error ? e.message : String(e) });
  }
}
