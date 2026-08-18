import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { SearchQuerySchema } from "@/modules/search/schema";
import { globalSearch } from "@/modules/search/queries";
import { jsonOk, jsonServerError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// SRCH-01: the global (Ctrl-K) search endpoint. Admin-only, exactly like the sibling
// admin list routes — partners have their own scoped portal search. Params are
// Zod-normalized (a too-short or missing q degrades to an empty 200 result, never a
// 400), and the query layer holds the scope guard (PRN-08).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.read");
    if (gate) return gate;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { q } = SearchQuerySchema.parse(params);
    return jsonOk(await globalSearch(scope, q));
  } catch (e) {
    // F-42 / the board route's precedent: the CLIENT gets a static message plus the
    // traceId, and the real reason goes to the server log under that same id —
    // jsonServerError passes `detail` to logError (scrubbed) and never into the response
    // body, so a driver error's bound params can't be echoed back. The query text itself
    // is deliberately not in `detail` (SEC-05: it can be a seller's phone or name).
    return (
      authErrorResponse(e) ??
      jsonServerError("search_failed", "Search failed.", {
        message: e instanceof Error ? e.message : String(e),
      })
    );
  }
}
