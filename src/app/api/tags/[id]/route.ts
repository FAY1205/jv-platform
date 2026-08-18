import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { updateTag, deleteTag, TagNotFoundError, DuplicateTagNameError } from "@/modules/tags/tags";
import { UpdateTagSchema } from "@/modules/tags/schema";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// TAG-06 — the Settings manager's writes: PATCH renames and/or recolors, DELETE removes the
// tag AND detaches it everywhere in one transaction. Admin-only + CSRF, like the collection
// route. The delete CONFIRMATION (with its usage count) is a client concern — the server
// performs exactly what it was asked, once. The scope guard decides which tags exist for the
// caller, so a tag id from another tenant 404s identically to a deleted one.

/** Shared error mapping for both verbs. */
function tagErrorResponse(e: unknown) {
  const authResp = authErrorResponse(e);
  if (authResp) return authResp;
  if (e instanceof TagNotFoundError) return jsonError("not_found", e.message, 404);
  if (e instanceof DuplicateTagNameError) return jsonError("duplicate_tag", e.message, 409);
  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("invalid_id", "Invalid tag id.", 400);
  const parsed = UpdateTagSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "Nothing to change.", 400);
  try {
    const scope = await getServerScope();
    const adminOnly = requireCapabilityResponse(scope, "rules.manage");
    if (adminOnly) return adminOnly;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    await updateTag(scope, id, parsed.data, newTraceId());
    return jsonOk({ code: "ok", message: "Tag updated." });
  } catch (e) {
    return (
      tagErrorResponse(e) ??
      jsonServerError("tag_update_failed", "Failed to update the tag.", {
        message: e instanceof Error ? e.message : String(e),
      })
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("invalid_id", "Invalid tag id.", 400);
  try {
    const scope = await getServerScope();
    const adminOnly = requireCapabilityResponse(scope, "rules.manage");
    if (adminOnly) return adminOnly;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    await deleteTag(scope, id, newTraceId());
    return jsonOk({ code: "ok", message: "Tag deleted." });
  } catch (e) {
    return (
      tagErrorResponse(e) ??
      jsonServerError("tag_delete_failed", "Failed to delete the tag.", {
        message: e instanceof Error ? e.message : String(e),
      })
    );
  }
}
