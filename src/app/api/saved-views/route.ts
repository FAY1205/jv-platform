import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listSavedViews, createSavedView, DuplicateSavedViewNameError } from "@/modules/saved-views/saved-views";
import { CreateSavedViewSchema } from "@/modules/saved-views/schema";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";

// SV-02 — the caller's OWN saved views. GET powers the leads-page views dropdown; POST is
// "Save current filters…" and is always a CREATE (the overwrite path is PATCH on the resolved
// id — see modules/saved-views). ADMIN-ONLY v1: a partner session gets the same 403 every
// other admin surface returns. Tenant scoping alone would NOT separate views — partners share
// the tenant, and views are per USER, which the module predicate enforces on every query.
// POST is CSRF-protected.

export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    return jsonOk({ views: await listSavedViews(scope) });
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonServerError("saved_views_failed", "Failed to load saved views.", {
        message: e instanceof Error ? e.message : String(e),
      })
    );
  }
}

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const parsed = CreateSavedViewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A view name (1–60 characters) and a filter set are required.", 400);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    // tenant_id AND user_id come from the scope, never the body — the strict schema above
    // rejects a request that even names one (SV-02).
    return jsonOk(await createSavedView(scope, parsed.data));
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    // Narrow, constraint-gated 409: only the name index produces this (the tags F-6 lesson).
    if (e instanceof DuplicateSavedViewNameError) return jsonError("duplicate_view", e.message, 409);
    return jsonServerError("saved_view_create_failed", "Failed to save the view.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
