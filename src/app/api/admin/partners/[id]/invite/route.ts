import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getServerScope } from "@/lib/scope-context";
import { tenantWhere } from "@/lib/scope";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { provisionPartnerUser } from "@/lib/auth/provision";
import { notifyInvite } from "@/lib/auth/notify";
import { env } from "@/lib/env";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// PTL-01: admin invites a partner. Creates the partner's Supabase auth user (no
// password — OTP only), mirrors the users row, sets status→invited, and emails a
// branded invite link via the SEC-07 sink. Admin-only, CSRF-protected.
const IdSchema = z.string().uuid();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }

  let scope;
  try {
    scope = await getServerScope();
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("scope_failed", "Could not resolve session.", 500);
  }
  const forbidden = requireCapabilityResponse(scope, "partners.manage");
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);

  const db = getDb();
  const [partner] = await db
    .select({ id: schema.partners.id, refId: schema.partners.refId, email: schema.partners.email, status: schema.partners.status, isHouse: schema.partners.isHouse })
    .from(schema.partners)
    .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, id)));

  if (!partner) return jsonError("not_found", "Partner not found.", 404);
  // WP-D: the house row is the admin's own territory — it has no portal identity to invite.
  if (partner.isHouse) return jsonError("house_no_invite", "Your own territory can't be invited.", 422);
  if (!partner.email) return jsonError("no_email", "Add an email to this partner before inviting.", 422);

  try {
    await provisionPartnerUser(getSupabaseAdmin(), db, {
      tenantId: scope.tenantId,
      partnerId: partner.id,
      email: partner.email,
    });
  } catch (e) {
    return jsonError("provision_failed", e instanceof Error ? e.message : "Could not create the partner account.", 500);
  }

  await db
    .update(schema.partners)
    .set({ status: "invited", invitedAt: new Date() })
    .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, id)));

  // ACT-04 / F-05: partner invites are admin actions and must reach the audit trail.
  await db.insert(schema.auditLog).values({
    tenantId: scope.tenantId,
    actorUserId: scope.userId,
    action: "partner.invited",
    entityType: "partner",
    entityRef: partner.refId,
    before: { status: partner.status },
    after: { status: "invited", email: partner.email },
    traceId: globalThis.crypto.randomUUID(),
  });

  // C-101 (CWE-644): links that leave the system travel on env.APP_URL (the canonical origin,
  // prod-guarded in lib/env), never the request Host. This one carries no token, but a forged
  // Host would still mail a partner a branded "sign in here" link to an attacker's login page.
  await notifyInvite(partner.email, `${env.APP_URL}/portal/login`);

  return jsonOk({ code: "ok", message: "Invitation sent." });
}
