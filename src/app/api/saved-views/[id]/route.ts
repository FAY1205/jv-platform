import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import {
  updateSavedView, deleteSavedView, SavedViewNotFoundError, DuplicateSavedViewNameError,
} from "@/modules/saved-views/saved-views";
import { UpdateSavedViewSchema } from "@/modules/saved-views/schema";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

/** SEC-05 (audit-tenancy F-9): never `e.message` in a 500 detail — a driver error quotes the
 *  offending row, and `filters.q` is free text an admin types seller names into. See the
 *  collection route for the full reasoning. */
function failureDetail(e: unknown): Record<string, unknown> {
  const { code, constraint } = pgErrorInfo(e);
  return { pgCode: code ?? null, constraint: constraint ?? null, name: e instanceof Error ? e.name : typeof e };
}

// SV-03 — one saved view: PATCH renames and/or re-saves the filters (this is the
// overwrite-on-save path), DELETE removes it. Admin-only + CSRF, like the collection route.
// The scope predicate decides which views exist for the caller, so ANOTHER USER's id 404s
// identically to a deleted one — the cross-user boundary never reports itself.

/** Shared error mapping for both verbs. */
function savedViewErrorResponse(e: unknown) {
  const authResp = authErrorResponse(e);
  if (authResp) return authResp;
  if (e instanceof SavedViewNotFoundError) return jsonError("not_found", e.message, 404);
  if (e instanceof DuplicateSavedViewNameError) return jsonError("duplicate_view", e.message, 409);
  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("invalid_id", "Invalid view id.", 400);
  const parsed = UpdateSavedViewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "Nothing to change.", 400);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "views.own");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    await updateSavedView(scope, id, parsed.data);
    return jsonOk({ code: "ok", message: "View saved." });
  } catch (e) {
    return (
      savedViewErrorResponse(e) ??
      jsonServerError("saved_view_update_failed", "Failed to save the view.", failureDetail(e))
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("invalid_id", "Invalid view id.", 400);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "views.own");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    await deleteSavedView(scope, id);
    return jsonOk({ code: "ok", message: "View deleted." });
  } catch (e) {
    return (
      savedViewErrorResponse(e) ??
      jsonServerError("saved_view_delete_failed", "Failed to delete the view.", failureDetail(e))
    );
  }
}
