import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { jsonOk, jsonError } from "@/lib/http";

// ACC-02 / AUT-10: revoke a trusted-device family. Self may revoke their own; an
// admin may revoke any device in their tenant (admin-revokes-partner). CSRF-protected.
const IdSchema = z.string().uuid();

export async function POST(request: Request, { params }: { params: Promise<{ familyId: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }

  const { familyId } = await params;
  if (!IdSchema.safeParse(familyId).success) return jsonError("invalid_id", "Invalid device id.", 400);

  let scope;
  try {
    scope = await getServerScope();
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("scope_failed", "Could not resolve session.", 500);
  }

  const svc = new TrustedDeviceService(getDb());
  const owner = await svc.familyScope(familyId);
  if (!owner) return jsonError("not_found", "Device not found.", 404);

  const allowed = owner.userId === scope.userId || (scope.role === "admin" && owner.tenantId === scope.tenantId);
  if (!allowed) return jsonError("forbidden", "Not allowed.", 403);

  await svc.revokeFamily(familyId, Date.now());
  return jsonOk({ code: "ok", message: "Device signed out." });
}
