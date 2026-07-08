import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { updateMlsPattern, RuleNotFoundError } from "@/modules/rules/commands";
import { MlsPatternUpdateSchema } from "@/modules/rules/schema";
import { jsonOk, jsonError } from "@/lib/http";

const IdSchema = z.string().uuid();

// CVG-02: toggle an MLS phrase on/off or edit its label. Regex is never editable
// here (PRN-04) — the schema strips any smuggled `regex` field.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid id.", 400);
    const parsed = MlsPatternUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    await updateMlsPattern(scope, id, parsed.data);
    return jsonOk({ code: "ok", message: "Updated." });
  } catch (e) {
    if (e instanceof RuleNotFoundError) return jsonError("not_found", e.message, 404);
    return authErrorResponse(e) ?? jsonError("mls_update_failed", "Could not update the phrase.", 500);
  }
}
