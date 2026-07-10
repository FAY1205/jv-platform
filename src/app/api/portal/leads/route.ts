import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listPartnerLeads } from "@/modules/portal/queries";
import { jsonOk, jsonServerError } from "@/lib/http";

// GET /api/portal/leads?page=N — the caller's own leads, server-side paginated (PTL-02, FEP-03).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data on ToS acceptance
    if (tos) return tos;
    const raw = Number(new URL(request.url).searchParams.get("page") ?? "1");
    const page = Number.isFinite(raw) && raw > 0 ? raw : 1;
    return jsonOk(await listPartnerLeads(scope, page));
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("leads_failed", "Failed to load leads.", { message: e instanceof Error ? e.message : String(e) });
  }
}
