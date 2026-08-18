import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { recordTosAcceptance } from "@/lib/auth/tos-store";
import { CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import { jsonOk, jsonError } from "@/lib/http";
import { isPartnerStream } from "@/lib/scope";

// LGL-01: the authenticated user accepts the current ToS/Privacy version. For a
// partner completing onboarding, this promotes invited → active. CSRF-protected.
export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }

  let scope;
  try {
    scope = await getServerScope();
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("scope_failed", "Could not resolve session.", 500);
  }

  const db = getDb();
  await recordTosAcceptance(db, scope.userId, CURRENT_TOS_VERSION);

  // Onboarding complete → activate the partner (only promotes from "invited").
  if (isPartnerStream(scope) && scope.partnerId) {
    await db
      .update(schema.partners)
      .set({ status: "active", activatedAt: new Date() })
      .where(and(eq(schema.partners.id, scope.partnerId), eq(schema.partners.status, "invited")));
  }

  return jsonOk({ code: "ok", message: "Accepted." });
}
