import { type NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import type { ScopeContext } from "@/lib/scope";

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

// The role × capability matrix (role-model-recommendation §2.3). Owner-vs-admin
// differences are NOT here — they are the two team-handler invariants (only the
// workspace owner touches admin seats / transfers ownership; nobody touches the
// owner). Defaults pending owner review: member gets ingest.run + ai.use (void
// and export stay admin-only); viewer is read-only everywhere, no AI.
const TIER_CAPABILITIES: Record<AdminTier, ReadonlySet<Capability>> = {
  admin: new Set<Capability>(ALL),
  member: new Set<Capability>(["leads.read", "leads.write", "work.write", "views.own", "ingest.run", "ai.use"]),
  viewer: new Set<Capability>(["leads.read", "views.own"]),
};

/** True when `scope` may exercise `cap`. Partners are always false (stream, not tier). */
export function can(scope: ScopeContext, cap: Capability): boolean {
  if (scope.role === "partner") return false;
  return TIER_CAPABILITIES[scope.role].has(cap);
}

/** The full derived capability list for a scope — for /api/me → client UI gating only.
 *  The server guard below is authoritative; the client list only hides/disables chrome. */
export function capabilitiesOf(scope: ScopeContext): Capability[] {
  if (scope.role === "partner") return [];
  return ALL.filter((cap) => TIER_CAPABILITIES[scope.role as AdminTier].has(cap));
}

/**
 * Route gate: 403 unless the scope holds the capability. The uniform envelope and
 * message shape match requireAdminResponse so migrated routes are indistinguishable
 * to a probing client (no new-role oracle).
 */
export function requireCapabilityResponse(scope: ScopeContext, cap: Capability): NextResponse | null {
  return can(scope, cap) ? null : jsonError("forbidden", "You don't have access to this action.", 403);
}
