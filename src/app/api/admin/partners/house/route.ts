import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { ensureHousePartner } from "@/modules/partners/commands";
import { jsonOk, jsonError } from "@/lib/http";

// WP-D (ADR-0037): create (or return) the tenant's house partner — the admin's own territory.
// Idempotent; the command's advisory lock + is_house partial unique index guarantee one per tenant.
// Admin-only, CSRF-protected. A static segment, so it never collides with /partners/[id].
export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;

    const partner = await ensureHousePartner(scope);
    return jsonOk({ code: "ok", message: "House territory ready.", partner });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("house_create_failed", "Could not set up your territory.", 500);
  }
}
