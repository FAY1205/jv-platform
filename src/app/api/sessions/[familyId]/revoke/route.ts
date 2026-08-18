import { z } from "zod";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { jsonOk, jsonError } from "@/lib/http";
import { can } from "@/lib/authz";

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

  const db = getDb();
  const svc = new TrustedDeviceService(db);
  const owner = await svc.familyScope(familyId);
  if (!owner) return jsonError("not_found", "Device not found.", 404);

  const allowed = owner.userId === scope.userId || (can(scope, "ops.admin") && owner.tenantId === scope.tenantId);
  if (!allowed) return jsonError("forbidden", "Not allowed.", 403);

  await svc.revokeFamily(familyId, Date.now());

  // ACC-02 / F-05: an admin forcing another user's device off is admin evidence and
  // must reach the audit trail (self sign-out is a routine action, not audited here).
  if (can(scope, "ops.admin") && owner.userId !== scope.userId) {
    await db.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "partner.session_revoked",
      entityType: "trusted_device",
      entityRef: familyId,
      before: null,
      after: { targetUserId: owner.userId },
      traceId: globalThis.crypto.randomUUID(),
    });
  }

  return jsonOk({ code: "ok", message: "Device signed out." });
}
