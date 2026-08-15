import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { SearchQuerySchema } from "@/modules/search/schema";
import { globalSearch } from "@/modules/search/queries";
import { jsonOk, jsonServerError } from "@/lib/http";

// SRCH-01: the global (Ctrl-K) search endpoint. Admin-only, exactly like the sibling
// admin list routes — partners have their own scoped portal search. Params are
// Zod-normalized (a too-short or missing q degrades to an empty 200 result, never a
// 400), and the query layer holds the scope guard (PRN-08).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { q } = SearchQuerySchema.parse(params);
    return jsonOk(await globalSearch(scope, q));
  } catch (e) {
    // SEC-05: the query text is user data — the 500 envelope carries a traceId, not the
    // failure detail or the search terms.
    return authErrorResponse(e) ?? jsonServerError("search_failed", "Search failed.");
  }
}
