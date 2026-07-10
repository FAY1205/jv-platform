import { type NextResponse } from "next/server";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { jsonError } from "@/lib/http";
import type { ScopeContext } from "@/lib/scope";
import { latestTosVersion } from "./tos-store";
import { needsTosAcceptance } from "@/lib/legal/tos";

type DB = PostgresJsDatabase<typeof schema>;

/**
 * F-04 / TR-4 / LGL-01: a portal DATA route must refuse a partner who has not accepted
 * the CURRENT Terms of Service — not just the `/portal` landing page. Before this, a
 * partner could skip the landing gate and read/mutate their leads via a direct API call.
 * Admins are exempt (the ToS gate is the partner-portal onboarding step). The check is
 * scoped to the caller's own user id (PRN-08). Returns a 403 `tos_required` envelope, or
 * null when the caller may proceed.
 */
export async function requireTosResponse(db: DB, scope: ScopeContext): Promise<NextResponse | null> {
  if (scope.role !== "partner") return null;
  const accepted = await latestTosVersion(db, scope.userId);
  if (needsTosAcceptance(accepted)) {
    return jsonError("tos_required", "Please accept the current Terms of Service to continue.", 403);
  }
  return null;
}
