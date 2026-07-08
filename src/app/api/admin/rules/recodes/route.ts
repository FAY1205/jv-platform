import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { createRecode } from "@/modules/rules/commands";
import { RecodeSchema } from "@/modules/rules/schema";
import { jsonOk, jsonError } from "@/lib/http";

// CVG-02: create a campaign recode (e.g. "Lead Zolo*" → "Z").
export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const parsed = RecodeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    const created = await createRecode(scope, parsed.data);
    return jsonOk({ code: "ok", message: "Recode added.", id: created.id });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("recode_create_failed", "Could not add the recode.", 500);
  }
}
