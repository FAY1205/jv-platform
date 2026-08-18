import { type NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { isPartnerStream, type ScopeContext } from "@/lib/scope";

// ─────────────────────────────────────────────────────────────────────────────
// The capability seam (Phase C / WP-ROLE-1). Every allow/deny decision for the
// admin-stream tiers goes through here; application code never compares
// `scope.role` to a literal outside src/lib/scope.ts and this module (enforced
// by tests/unit/role-literal-ban.test.ts). Capabilities are cluster-grained —
// deliberately 13, not per-endpoint — and DERIVED from the role (a pure function
// of ScopeContext), not stored on it: the matrix has exactly one definition, the
// JWT stays small, and resolveScope stays pure.
//
// Tiers: `admin` (full workspace control; the workspace owner — tenants.
// owner_user_id — is an admin with extra team-management invariants enforced in
// the team handlers, not here), `member` (does the lead work), `viewer`
// (read-only staff). `partner` is NOT a tier: partners are the other STREAM
// (PRN-13) and every capability is false for them — partner reachability is
// scope-shaped (ADR-0047), never capability-granted.
// ─────────────────────────────────────────────────────────────────────────────

/** Admin-stream tiers. `partner` is deliberately not representable here. */
export type AdminTier = "admin" | "member" | "viewer";

export type Capability =
  | "leads.read" // cluster A reads + dashboard + search
  | "leads.write" // cluster A writes: edit/status/assign/backfill/lead-tags
  | "work.write" // notes + tasks authoring (admin stream), notification mgmt
  | "views.own" // per-user surfaces: saved views, own sessions, /api/me
  | "ingest.run" // uploads + runs read + templates
  | "runs.void" // void/recall a run (destructive, notifies partners)
  | "data.export" // run export + data-settings export (PII egress)
  | "rules.manage" // rules read/coverage edit + tag management
  | "partners.manage" // partner CRUD/invite/deactivate/coverage/performance
  | "settings.manage" // workspace/notification/data settings + AI keys
  | "ai.use" // assistant chat + feedback
  | "team.manage" // team invites, role changes, seat lifecycle
  | "ops.admin"; // activity log, unlock, outbox drain, revoke-others

const ALL: readonly Capability[] = [
  "leads.read",
  "leads.write",
  "work.write",
  "views.own",
  "ingest.run",
  "runs.void",
  "data.export",
  "rules.manage",
  "partners.manage",
  "settings.manage",
  "ai.use",
  "team.manage",
  "ops.admin",
];

// The DEFAULT role × capability matrix (role-model-recommendation §2.3). Owner-vs-admin
// differences are NOT here — they are the two team-handler invariants (only the
// workspace owner touches admin seats / transfers ownership; nobody touches the
// owner). Defaults pending owner review: member gets ingest.run + ai.use (void
// and export stay admin-only); viewer is read-only, no AI.
//
// CONFIGURABLE (owner requirement 2026-08-18): these are DEFAULTS, not the law. A tenant
// may edit which capabilities its member/viewer tiers hold (stored per tenant, resolved
// onto ScopeContext.capabilities by getServerScope in the schema WP); the ADMIN tier is
// locked-full (the Twenty `isEditable=false` analog) so a workspace can never configure
// itself into a lockout. A scope WITHOUT a resolved set (system-fabricated scopes, tests,
// pre-migration tenants) falls back to these defaults.
export const DEFAULT_TIER_CAPABILITIES: Record<AdminTier, ReadonlySet<Capability>> = {
  admin: new Set<Capability>(ALL),
  member: new Set<Capability>(["leads.read", "leads.write", "work.write", "views.own", "ingest.run", "ai.use"]),
  viewer: new Set<Capability>(["leads.read", "views.own"]),
};

// ── The three-band split (ADR-0049 §11.3) ────────────────────────────────────
// Every capability belongs to exactly one band; a new capability that isn't
// classified fails the AUTHZ-07 partition test at build time.

/** Not removable from ANY staff tier: a seat that can see nothing is a lockout
 *  foot-gun, and views.own covers own-sessions/password self-service. */
export const ALWAYS_ON: ReadonlySet<Capability> = new Set(["leads.read", "views.own"]);

/** Tenant-editable per tier (member/viewer columns of the permissions editor). */
export const TENANT_EDITABLE: ReadonlySet<Capability> = new Set([
  "leads.write",
  "work.write",
  "ingest.run",
  "runs.void",
  "data.export",
  "rules.manage",
  "partners.manage",
  "ai.use",
]);

/** Never grantable to member/viewer in v1: settings.manage includes AI keys AND the
 *  permissions editor itself; team.manage is lateral escalation; ops.admin is security
 *  operations. Structurally enforced by effectiveCapabilities, not just UI. */
export const ADMIN_LOCKED: ReadonlySet<Capability> = new Set(["team.manage", "settings.manage", "ops.admin"]);

/**
 * The ONE normalizer between stored tenant config and an enforceable capability set
 * (ADR-0049 §11.2). `stored === null` (no row) ⇒ the live code defaults — a tenant that
 * never expressed a choice tracks default improvements. Else `(stored ∩ TENANT_EDITABLE)
 * ∪ ALWAYS_ON`: read-side normalization silently STRIPS locked/unknown keys (even a
 * hand-edited DB row can never grant an admin-locked capability) and re-unions the
 * always-on floor. The WRITE side (PATCH /api/admin/team/permissions, PR 4) Zod-rejects
 * locked/unknown keys loudly instead — an editor bug must surface, not vanish.
 */
export function effectiveCapabilities(tier: AdminTier, stored: readonly string[] | null): ReadonlySet<Capability> {
  if (tier === "admin") return DEFAULT_TIER_CAPABILITIES.admin; // locked-full
  if (stored === null) return DEFAULT_TIER_CAPABILITIES[tier];
  const out = new Set<Capability>(ALWAYS_ON);
  for (const key of stored) {
    if (TENANT_EDITABLE.has(key as Capability)) out.add(key as Capability);
  }
  return out;
}

/** True when `scope` may exercise `cap`. Partners are always false (stream, not tier);
 *  admin is always true (locked-full tier); member/viewer consult the tenant-configured
 *  set when the scope carries one, else the defaults. */
export function can(scope: ScopeContext, cap: Capability): boolean {
  if (scope.role === "partner") return false;
  if (scope.role === "admin") return true;
  // Deny-by-default on an unrecognized tier (audit-tenancy F-7): a role value this matrix
  // has never heard of (a widened enum shipped ahead of a matrix row) grants NOTHING.
  return (scope.capabilities ?? DEFAULT_TIER_CAPABILITIES[scope.role])?.has(cap) ?? false;
}

/** The full derived capability list for a scope — for /api/me → client UI gating only.
 *  The server guard below is authoritative; the client list only hides/disables chrome. */
export function capabilitiesOf(scope: ScopeContext): Capability[] {
  if (scope.role === "partner") return [];
  return ALL.filter((cap) => can(scope, cap));
}

/**
 * Route gate: 403 unless the scope holds the capability. The uniform envelope and
 * message shape match requireAdminResponse so migrated routes are indistinguishable
 * to a probing client (no new-role oracle).
 */
export function requireCapabilityResponse(scope: ScopeContext, cap: Capability): NextResponse | null {
  return can(scope, cap) ? null : jsonError("forbidden", "You don't have access to this action.", 403);
}

/**
 * ADR-0047 pass-through gate for /api/portal/** and the shared notes/tasks routes
 * (audit-tenancy F-1/F-2, Phase C amendment to the ADR). A PARTNER passes on scope
 * alone — exactly as ADR-0047 decided; partners hold no capability by construction and
 * the scope guard is their boundary. An ADMIN-STREAM caller flowing through the same
 * partner-shaped code gets the WHOLE TENANT back (leadWhere's admin arm), so it must
 * hold the capability the equivalent admin surface requires — without this, a viewer
 * would pull a full-tenant seller-PII export through the portal export route.
 */
export function requirePassthroughResponse(scope: ScopeContext, cap: Capability): NextResponse | null {
  return isPartnerStream(scope) ? null : requireCapabilityResponse(scope, cap);
}
