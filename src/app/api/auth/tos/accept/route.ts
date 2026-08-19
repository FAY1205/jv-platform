import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { recordTosAcceptance } from "@/lib/auth/tos-store";
import { CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import { jsonOk, jsonError } from "@/lib/http";
import { isPartnerStream, tenantIdWhere } from "@/lib/scope";
import { notifyPartnerActivated } from "@/modules/notify/events";

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
    // WP-NF2 NTF-11: `.returning()` is what makes the notification a ONE-SHOT. The UPDATE was
    // already conditional on `status = 'invited'`, but the route never observed whether it
    // moved anything — so a partner re-accepting an updated ToS would have re-notified every
    // admin that they "accepted their invite", every time. Zero rows back = no transition = no
    // emit. Claim-by-conditional-write, the same pattern the task-reminder one-shot uses.
    //
    // PRN-08 (audit-tenancy F-1): the WHERE carries the TENANT PIN, not just the partner id.
    // `scope.partnerId` comes from the session, but an id is not a scope — a partner id is a
    // uuid that exists globally, so "the session named it" is an authentication fact, not an
    // authorization one. The tenant predicate is the boundary, and there is nothing behind it:
    // `partners` writes here go through the service role, so RLS is not a second line of
    // defence (ADR-0013 — the app layer IS the boundary). Defense in depth: a reachability
    // probe on production found 0 cross-tenant and 0 dangling `users.partner_id` links, so no
    // scope that resolves today could reach another tenant's row — this makes that a property
    // of the STATEMENT rather than of the data.
    const promoted = await db
      .update(schema.partners)
      .set({ status: "active", activatedAt: sql`now()` })
      .where(
        and(
          tenantIdWhere(schema.partners, scope.tenantId),
          eq(schema.partners.id, scope.partnerId),
          eq(schema.partners.status, "invited"),
        ),
      )
      .returning({ id: schema.partners.id });
    if (promoted.length > 0) {
      // Best-effort (the emit swallows internally): onboarding must complete even if the
      // admins' bell does not.
      await notifyPartnerActivated(db, scope.tenantId, { partnerId: scope.partnerId });
    }
  }

  return jsonOk({ code: "ok", message: "Accepted." });
}
