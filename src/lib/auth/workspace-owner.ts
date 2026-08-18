import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema";
import type { ScopeContext } from "@/lib/scope";

// ─────────────────────────────────────────────────────────────────────────────
// Phase C (ADR-0049): the WORKSPACE OWNER — tenants.owner_user_id, the tenant's
// root admin seat. NOT the ADR-0040 "platform owner" (env allowlist, platform
// surfaces); the two tiers never share a mechanism, and bare "owner" is banned
// in code and copy to keep them apart. Owner-only invariants live in the team
// handlers: only the owner touches admin seats or transfers ownership; nobody
// demotes/deactivates the owner. A NULL owner (bare/test tenants, pre-backfill
// rows) simply means no seat is owner-protected yet.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** The tenant's owner user id (null when unset). Always read live — never cached
 *  on the scope (ownership transfer must bind next-request, like role changes). */
export async function workspaceOwnerId(db: DB, scope: ScopeContext): Promise<string | null> {
  const [row] = await db
    .select({ ownerUserId: schema.tenants.ownerUserId })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, scope.tenantId));
  return row?.ownerUserId ?? null;
}

/** True iff the CALLER is their workspace's owner. */
export async function isWorkspaceOwner(db: DB, scope: ScopeContext): Promise<boolean> {
  const owner = await workspaceOwnerId(db, scope);
  return owner !== null && owner === scope.userId;
}
