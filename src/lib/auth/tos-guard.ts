import { type NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { jsonError } from "@/lib/http";
import type { ScopeContext } from "@/lib/scope";
import { latestTosVersion } from "./tos-store";
import { needsTosAcceptance } from "@/lib/legal/tos";

type DB = PostgresJsDatabase<typeof schema>;

/**
 * F-04 / TR-4 / LGL-01: a DATA route must refuse a caller who has not accepted the CURRENT
 * Terms of Service — not just the landing page. Before this, a partner could skip the
 * landing gate and read/mutate their leads via a direct API call.
 *
 * WP-SU-5: admins are no longer blanket-exempt. That exemption was correct while every
 * admin was provisioned by the owner's own script, and wrong the moment public self-serve
 * signup let a stranger become one. A self-serve admin accepts at provisioning, so this
 * only bites after `CURRENT_TOS_VERSION` is bumped — exactly the re-acceptance LGL-01 asks
 * for. Owner/script-provisioned tenants (`self_serve = false`, the default for every
 * pre-existing row) have NO acceptance record, so gating them would lock the owner out of
 * their own app on the first version bump; they stay exempt.
 *
 * Both reads are scoped to the caller's own tenant/user id (PRN-08).
 *
 * This is the single decision, shared by the API guard below and the page-level gate in
 * `src/app/dashboard/layout.tsx`, so a route and a page can never disagree about who is
 * gated — and so the escape hatch (`/tos`) is never itself gated.
 */
export async function needsTosGate(db: DB, scope: ScopeContext): Promise<boolean> {
  if (scope.role !== "partner") {
    const [tenant] = await db
      .select({ selfServe: schema.tenants.selfServe })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, scope.tenantId));
    // Unknown tenant ⇒ exempt: this guard must never be the thing that denies a caller
    // whose scope already resolved. Fail open HERE is correct — the scope guard (PRN-08)
    // is what authorises access; this only enforces a legal acknowledgement.
    if (!tenant?.selfServe) return false;
  }
  return needsTosAcceptance(await latestTosVersion(db, scope.userId));
}

/** API form of the same decision: a 403 `tos_required` envelope, or null to proceed. */
export async function requireTosResponse(db: DB, scope: ScopeContext): Promise<NextResponse | null> {
  if (!(await needsTosGate(db, scope))) return null;
  return jsonError("tos_required", "Please accept the current Terms of Service to continue.", 403);
}
