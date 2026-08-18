import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { PermissionsPatchSchema } from "@/modules/team/schema";
import { getPermissions, updatePermissions } from "@/modules/team/team";

// ADR-0049 §11.4: the tenant permissions editor. ONE payload feeds the matrix card, the
// invite-dialog role descriptions and the demotion warnings (TM-12 — no copy drift).
// Gate: team.manage (admin-locked) — cohesion with the Team page it lives on.
export async function GET() {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "team.manage");
    if (gate) return gate;
    return jsonOk(await getPermissions(getDb(), scope));
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonServerError("permissions_failed", "Could not load permissions.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}

// Declarative per-tier swap; `null` resets a tier to the live defaults (row DELETE —
// an unconfigured tenant keeps tracking default improvements). Zod REJECTS locked or
// unknown capability keys loudly (400) — read-side normalization is the backstop, the
// write side never silently strips (ADR-0049 §11.2). Audited before/after (ACT-04).
export async function PATCH(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "team.manage");
    if (gate) return gate;
    const parsed = PermissionsPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("invalid_input", "Only tenant-editable capabilities can be granted here.", 400);
    }
    return jsonOk(await updatePermissions(getDb(), scope, parsed.data, globalThis.crypto.randomUUID()));
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonServerError("permissions_failed", "Could not update permissions.", { message: e instanceof Error ? e.message : String(e) })
    );
  }
}
