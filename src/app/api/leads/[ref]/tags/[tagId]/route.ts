import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { detachTag, LeadNotFoundError, TagNotFoundError } from "@/modules/tags/tags";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";

// TAG-03 — detach ONE tag from ONE lead (the chip's ✕). IDEMPOTENT: removing a tag the lead
// no longer carries is a 200 no-op, so a double-click or a stale row never surfaces an error.
// Admin-only (TAG-02) + CSRF. The target lives in the URL, not a DELETE body — the house
// shape for "remove this specific child".
const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);

export async function DELETE(request: Request, { params }: { params: Promise<{ ref: string; tagId: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { ref, tagId } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  if (!z.string().uuid().safeParse(tagId).success) return jsonError("invalid_id", "Invalid tag id.", 400);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    return jsonOk(await detachTag(scope, ref, tagId, newTraceId()));
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError || e instanceof TagNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonServerError("tag_detach_failed", "Failed to remove the tag.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
