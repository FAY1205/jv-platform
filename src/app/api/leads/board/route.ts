import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { BoardQuerySchema } from "@/modules/leads/schema";
import { listLeadsBoard } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";

// ADM · KAN-02: the Leads board read. Same leads as GET /api/leads, bucketed by their
// current status, kept + non-deleted only (KAN-08). Admin-only like its sibling list
// route (the portal keeps its list — owner decision); scoped via the guard (PRN-08).
// Params are Zod-normalized, so a nonsense filter degrades to the default rather than
// 400-ing. Read-only: the board's writes go through the EXISTING
// POST /api/leads/{ref}/status (KAN-04) — no new write path.
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const query = BoardQuerySchema.parse(params);
    return jsonOk(await listLeadsBoard(scope, query));
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("leads_board_failed", e instanceof Error ? e.message : "Failed to load the board", 500)
    );
  }
}
