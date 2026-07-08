import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { updateRecode, deleteRecode, RuleNotFoundError } from "@/modules/rules/commands";
import { RecodeSchema } from "@/modules/rules/schema";
import { jsonOk, jsonError } from "@/lib/http";

const IdSchema = z.string().uuid();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid id.", 400);
    const parsed = RecodeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    await updateRecode(scope, id, parsed.data);
    return jsonOk({ code: "ok", message: "Recode updated." });
  } catch (e) {
    if (e instanceof RuleNotFoundError) return jsonError("not_found", e.message, 404);
    return authErrorResponse(e) ?? jsonError("recode_update_failed", "Could not update the recode.", 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid id.", 400);
    await deleteRecode(scope, id);
    return jsonOk({ code: "ok", message: "Recode removed." });
  } catch (e) {
    if (e instanceof RuleNotFoundError) return jsonError("not_found", e.message, 404);
    return authErrorResponse(e) ?? jsonError("recode_delete_failed", "Could not remove the recode.", 500);
  }
}
