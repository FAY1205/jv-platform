import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import { renameWorkspace } from "@/modules/settings/workspace";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// Workspace settings — rename the tenant. Admin-only, CSRF-guarded, audited (PRN-08).
const PutSchema = z.object({ name: z.string().trim().min(1, "A workspace name is required").max(120) });

export async function PUT(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "settings.manage");
    if (gate) return gate;
    const parsed = PutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    await renameWorkspace(scope, parsed.data.name);
    return jsonOk({ code: "ok", message: "Saved." });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("workspace_save_failed", "Could not save.", 500);
  }
}
