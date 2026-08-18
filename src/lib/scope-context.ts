import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { effectiveCapabilities } from "@/lib/authz";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side scope resolution (WP-023, AUT-13). The authenticated Supabase
// session's access token is verified (locally via getClaims against the project's asymmetric
// signing key — WP-PERF-AUTH; falls back to a network getUser for HS256/alg:none), then the
// caller is mapped to a ScopeContext via the authoritative `users` row — keyed by the VERIFIED
// auth uid (the token's `sub` claim), never by client-supplied headers. The scope guard
// (lib/scope.ts) and RLS are unchanged; only the source of the scope changed.
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
  role: "admin" | "partner" | "member" | "viewer";
  partnerId: string | null;
  /** Phase C seat lifecycle: a deactivated seat is refused a session. Optional so the
   *  pure mapping stays constructible from older shapes (tests, fabricated rows). */
  deactivatedAt?: Date | null;
  /** Tenant-configured capability array for member/viewer (role_capabilities row), or
   *  null/absent when the tenant has expressed no choice (⇒ code defaults). */
  storedCapabilities?: string[] | null;
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
  // Fail securely on an unknown role value (audit-tenancy F-7): a widened enum shipped ahead
  // of this mapping must refuse the session, not construct a scope no gate has heard of.
  if (!["admin", "partner", "member", "viewer"].includes(row.role)) {
    throw new NotProvisionedError("Account role is not recognized.");
  }
  // Phase C seat lifecycle: the partner-revocation twin for staff — a deactivated seat
  // is refused a session; the row (and everything it authored) persists.
  if (row.deactivatedAt != null) {
    throw new NotProvisionedError("This account has been deactivated.");
  }
  if (row.role === "partner") {
    if (!row.partnerId) {
      throw new NotProvisionedError("Partner account is missing its partner link.");
    }
    if (partner && (partner.status === "revoked" || partner.deletedAt != null)) {
      throw new NotProvisionedError("This partner account is no longer active.");
    }
  } else if (row.partnerId) {
    // SCP-01 at the source (Phase C): a NON-partner row carrying a partner_id is corrupt —
    // no provisioning path writes it, and admitting it would let an admin-stream user be
    // counted into a partner org's authored sets. Refuse the session rather than guess.
    throw new NotProvisionedError("Account role does not match its partner link.");
  }
  const scope: ScopeContext = { tenantId: row.tenantId, role: row.role, userId: user.id };
  if (row.role === "partner") scope.partnerId = row.partnerId as string;
  // ADR-0049: member/viewer carry their tenant-configured capability set, normalized
  // through the ONE authz normalizer (locked/unknown keys stripped, always-on floor
  // unioned; null/absent ⇒ live code defaults). Admin/partner never carry the field.
  if (row.role === "member" || row.role === "viewer") {
    scope.capabilities = effectiveCapabilities(row.role, row.storedCapabilities ?? null);
  }
  return scope;
}

/**
 * Pure: the verified subject (auth user id) from a `getClaims()` result, or
 * UnauthenticatedError. getClaims has ALREADY verified the token's signature + expiry against
 * the project's asymmetric key (or bounced an HS256 / alg:none token to a network getUser that
 * rejects a forgery), so a present, non-empty string `sub` is a trustworthy user id. Identity
 * comes ONLY from the verified claim — never from a request header (spoofing fence, PRN-08).
 */
export function subjectFromClaims(
  data: { claims?: { sub?: unknown } | null } | null | undefined,
  error: unknown,
): string {
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string" || sub.length === 0) throw new UnauthenticatedError();
  return sub;
}

/**
 * Resolve the scope for the current request from the authenticated Supabase
 * session. Throws UnauthenticatedError when there is no valid session and
 * NotProvisionedError when the user has no membership. The Supabase client is
 * imported lazily so pure consumers of resolveScope never load `next/headers`.
 *
 * WP-PERF-AUTH (C-42): the token is verified LOCALLY via `getClaims()` against the project's
 * asymmetric signing key + a module-cached JWKS — not a second network `getUser()`. The
 * middleware (proxy.ts) already did one network verify + token refresh this request, so the
 * route only needs to confirm the signature it just rotated, then re-read the authoritative
 * `users`/`partners` rows (which is what actually enforces tenant/role/partner revocation,
 * PRN-08/PTL-01 — unchanged and immediate). See docs/audit/2026-08-18-double-jwt-verify.md.
 */
export async function getServerScope(): Promise<ScopeContext> {
  const { getSupabaseServer } = await import("@/lib/supabase/server");
  const { getCachedJwks } = await import("@/lib/supabase/jwks");
  const supabase = await getSupabaseServer();
  const jwks = await getCachedJwks();
  // getClaims(undefined, …) reads the access token from the session cookie (local, no network),
  // validates exp, and verifies the ES256/RSA signature against the supplied JWKS. HS256 /
  // alg:none / unknown-kid fall back to a network getUser INSIDE getClaims (alg-confusion guard).
  // Cast: our cached JWKS is opaque JSON; getClaims types `jwks.keys` as the strict jose JWK[].
  // The SDK only reads `kid` + the standard verify fields — the shapes are compatible at runtime.
  const claimsOpts = (jwks ? { jwks } : undefined) as Parameters<typeof supabase.auth.getClaims>[1];
  const { data, error } = await supabase.auth.getClaims(undefined, claimsOpts);
  const userId = subjectFromClaims(data, error);

  const db = getDb();
  // ADR-0049: the tenant's configured capability row for this user's tier rides the SAME
  // round trip (LEFT JOIN on (tenant, role)) — the Slice-2 lesson is that request latency
  // is round trips, not DB work. Admin/partner rows simply join to nothing.
  const [row] = await db
    .select({
      tenantId: schema.users.tenantId,
      role: schema.users.role,
      partnerId: schema.users.partnerId,
      deactivatedAt: schema.users.deactivatedAt,
      storedCapabilities: schema.roleCapabilities.capabilities,
    })
    .from(schema.users)
    .leftJoin(
      schema.roleCapabilities,
      and(
        eq(schema.roleCapabilities.tenantId, schema.users.tenantId),
        eq(schema.roleCapabilities.role, schema.users.role),
      ),
    )
    .where(eq(schema.users.id, userId));

  // For a partner, consult the partner lifecycle so a revoked/soft-deleted partner
  // cannot resolve a session (PTL-01).
  let partner: PartnerState | undefined;
  if (row?.role === "partner" && row.partnerId) {
    const [p] = await db
      .select({ status: schema.partners.status, deletedAt: schema.partners.deletedAt })
      .from(schema.partners)
      // R-67: scope the lifecycle lookup to the user's own tenant. Provisioning makes a
      // cross-tenant users.partner_id impossible today, but nothing in the schema enforces
      // it — without this, a mis-set partner_id would revoke-check the WRONG partner row.
      .where(and(eq(schema.partners.tenantId, row.tenantId), eq(schema.partners.id, row.partnerId)));
    if (p) partner = { status: p.status, deletedAt: p.deletedAt };
  }

  return resolveScope({ id: userId }, row ?? null, partner);
}
