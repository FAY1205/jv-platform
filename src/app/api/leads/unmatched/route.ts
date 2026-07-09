import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { listUnmatched } from "@/modules/leads/queries";
import { jsonOk, jsonError } from "@/lib/http";

// ASN-03: the unmatched inbox — gap leads grouped by state. Admin-only; scoped
// via the guard (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const groups = await listUnmatched(scope);
    return jsonOk({ groups });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("unmatched_list_failed", e instanceof Error ? e.message : "Failed to load unmatched leads", 500);
  }
}
