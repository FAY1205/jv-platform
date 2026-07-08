import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { provisionPartnerUser } from "@/lib/auth/provision";
import { notifyInvite } from "@/lib/auth/notify";
import { jsonOk, jsonError } from "@/lib/http";

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
  if (scope.role !== "admin") return jsonError("forbidden", "Admin only.", 403);

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);

  const db = getDb();
  const [partner] = await db
    .select({ id: schema.partners.id, email: schema.partners.email, status: schema.partners.status })
    .from(schema.partners)
    .where(and(eq(schema.partners.tenantId, scope.tenantId), eq(schema.partners.id, id)));

  if (!partner) return jsonError("not_found", "Partner not found.", 404);
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
    .where(and(eq(schema.partners.tenantId, scope.tenantId), eq(schema.partners.id, id)));

  const origin = new URL(request.url).origin;
  await notifyInvite(partner.email, `${origin}/portal/login`);

  return jsonOk({ code: "ok", message: "Invitation sent." });
}
