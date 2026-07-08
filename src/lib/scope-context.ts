import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side scope resolution (WP-023, AUT-13). The authenticated Supabase
// session is verified (getUser), then the caller is mapped to a ScopeContext via
// the authoritative `users` row — keyed by the VERIFIED auth uid, never by
// client-supplied claims. The scope guard (lib/scope.ts) and RLS are unchanged;
// only the source of the scope changed (was the Phase-1 dev stub).
//
// The DB row is the single source of truth (PRN-15 spirit); JWT app_metadata is
// still populated at provisioning so the RLS backstop has claims for any future
// authenticated (non-service) DB path (0001 migration).
// ─────────────────────────────────────────────────────────────────────────────

/** No verified session on the request → the caller is not authenticated (401). */
export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/** Authenticated, but no valid workspace membership → forbidden (403). */
export class NotProvisionedError extends Error {
  constructor(message = "Your account is not provisioned for this workspace.") {
    super(message);
    this.name = "NotProvisionedError";
  }
}

export interface AuthedUser {
  id: string;
}

export interface UserRow {
  tenantId: string;
  role: "admin" | "partner";
  partnerId: string | null;
}

/** Partner lifecycle state consulted when resolving a partner scope (PTL-01). */
export interface PartnerState {
  status: string;
  deletedAt: Date | null;
}

/**
 * Pure mapping: a verified user + the authoritative `users` row → a ScopeContext.
 * A partner row without a partnerId is refused rather than yielding an unscoped
 * partner query (PRN-08); a revoked or soft-deleted partner is refused a session
 * (PTL-01). Kept pure so the authz decision is unit-testable.
 */
export function resolveScope(
  user: AuthedUser | null,
  row: UserRow | null,
  partner?: PartnerState,
): ScopeContext {
  if (!user) throw new UnauthenticatedError();
  if (!row) throw new NotProvisionedError("No workspace membership for this account.");
  if (row.role === "partner") {
    if (!row.partnerId) {
      throw new NotProvisionedError("Partner account is missing its partner link.");
    }
    if (partner && (partner.status === "revoked" || partner.deletedAt != null)) {
      throw new NotProvisionedError("This partner account is no longer active.");
    }
  }
  const scope: ScopeContext = { tenantId: row.tenantId, role: row.role, userId: user.id };
  if (row.role === "partner") scope.partnerId = row.partnerId as string;
  return scope;
}

/**
 * Resolve the scope for the current request from the authenticated Supabase
 * session. Throws UnauthenticatedError when there is no valid session and
 * NotProvisionedError when the user has no membership. The Supabase client is
 * imported lazily so pure consumers of resolveScope never load `next/headers`.
 */
export async function getServerScope(): Promise<ScopeContext> {
  const { getSupabaseServer } = await import("@/lib/supabase/server");
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new UnauthenticatedError();

  const db = getDb();
  const [row] = await db
    .select({
      tenantId: schema.users.tenantId,
      role: schema.users.role,
      partnerId: schema.users.partnerId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, data.user.id));

  // For a partner, consult the partner lifecycle so a revoked/soft-deleted partner
  // cannot resolve a session (PTL-01).
  let partner: PartnerState | undefined;
  if (row?.role === "partner" && row.partnerId) {
    const [p] = await db
      .select({ status: schema.partners.status, deletedAt: schema.partners.deletedAt })
      .from(schema.partners)
      .where(eq(schema.partners.id, row.partnerId));
    if (p) partner = { status: p.status, deletedAt: p.deletedAt };
  }

  return resolveScope({ id: data.user.id }, row ?? null, partner);
}
