import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listTags, createTag, DuplicateTagNameError } from "@/modules/tags/tags";
import { CreateTagSchema } from "@/modules/tags/schema";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";

// TAG-03 — the tag roster. GET powers both the picker's type-ahead and the Settings manager
// (one payload, usage counts included); POST is create, used by the picker's create-inline
// and by Settings. ADMIN-ONLY (TAG-02): tags are operator workflow labels, so a partner
// session gets the same 403 every other admin surface returns — tenant scoping alone would
// NOT separate them, since partners share the tenant. POST is CSRF-protected.

export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const tos = await requireTosResponse(getDb(), scope); // F-04/LGL-01: self-serve admins must have accepted the current ToS
    if (tos) return tos;
    return jsonOk({ tags: await listTags(scope) });
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonServerError("tags_failed", "Failed to load tags.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const parsed = CreateTagSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A tag name (1–40 characters) is required.", 400);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    // tenant_id comes from the scope, never the body; an omitted color resolves to the next
    // palette slot server-side (TAG-04) so the client can't invent one off-palette.
    return jsonOk(await createTag(scope, parsed.data, newTraceId()));
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof DuplicateTagNameError) return jsonError("duplicate_tag", e.message, 409);
    return jsonServerError("tag_create_failed", "Failed to create the tag.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
