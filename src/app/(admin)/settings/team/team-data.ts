"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Capability } from "@/lib/authz";

// Phase C (team-page-spec / ADR-0049 §11): the client contracts + the ONE copy source for
// the Team page. TM-12 said "a single exported constant"; §11.4 amends it — WHICH
// capabilities a tier holds is tenant config, so the sets come from
// GET /api/admin/team/permissions and only the human LABELS live here. Matrix rows, invite
// role blurbs and the demotion warning all read the same payload, so they cannot drift.

export const TEAM_KEY = ["team"] as const;
export const TEAM_PERMISSIONS_KEY = ["team-permissions"] as const;

/** src/modules/team/team.ts → TeamMemberView. */
export interface TeamMemberView {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  isOwner: boolean;
  deactivatedAt: string | null;
  joinedAt: string;
}
/** src/modules/team/team.ts → TeamInviteView. */
export interface TeamInviteView {
  id: string;
  email: string;
  role: string;
  invitedByEmail: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}
export interface TeamView {
  ownerUserId: string | null;
  members: TeamMemberView[];
  invites: TeamInviteView[];
}

/** src/modules/team/team.ts → PermissionsView. */
export interface PermissionsView {
  defaults: Record<ConfigurableTier, Capability[]>;
  effective: Record<ConfigurableTier, Capability[]>;
  /** A stored row exists for this tier ⇒ "Reset to defaults" has something to undo. */
  configured: Record<ConfigurableTier, boolean>;
  editable: Capability[];
  alwaysOn: Capability[];
  adminLocked: Capability[];
}

export type ConfigurableTier = "member" | "viewer";
export type InvitableRole = "admin" | "member" | "viewer";

export const CONFIGURABLE_TIERS: readonly ConfigurableTier[] = ["member", "viewer"];
export const INVITABLE_ROLES: readonly InvitableRole[] = ["admin", "member", "viewer"];

export function useTeam() {
  return useQuery({ queryKey: TEAM_KEY, queryFn: () => apiGet<TeamView>("/api/admin/team") });
}

export function useTeamPermissions() {
  return useQuery({
    queryKey: TEAM_PERMISSIONS_KEY,
    queryFn: () => apiGet<PermissionsView>("/api/admin/team/permissions"),
  });
}

/** Human labels for the 13 capability keys (src/lib/authz.ts owns the catalog itself).
 *  The order is the matrix's row order: the always-on floor, then the editable band,
 *  then the admin-locked band — the same top-to-bottom story the card tells. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  "leads.read": "View dashboards & leads",
  "views.own": "Saved views & own account",
  "leads.write": "Edit leads & statuses",
  "work.write": "Write notes & tasks",
  "ingest.run": "Upload & process files",
  "runs.void": "Void / recall runs",
  "data.export": "Export & download",
  "rules.manage": "Edit rules & coverage",
  "partners.manage": "Manage partners",
  "ai.use": "Use the AI assistant",
  "team.manage": "Manage team",
  "settings.manage": "Manage AI & settings",
  "ops.admin": "Activity log & security actions",
};

export function capabilityLabel(cap: Capability | string): string {
  return CAPABILITY_LABELS[cap as Capability] ?? cap;
}

/** Row order inside a band — the catalog order above, so a band renders predictably. */
const ORDER = Object.keys(CAPABILITY_LABELS) as Capability[];
export function inCatalogOrder(caps: readonly Capability[]): Capability[] {
  const set = new Set(caps);
  return ORDER.filter((c) => set.has(c));
}

/** Invite/role-card blurbs. Deliberately GENERIC (§11.3): the exact grants are tenant
 *  config, so the card points at the matrix instead of restating a set that can drift. */
export const ROLE_DESCRIPTIONS: Record<InvitableRole, string> = {
  admin: "Full workspace control: rules, partners, team, and settings.",
  member: "Day-to-day lead work — see What each role can do.",
  viewer: "Read-only staff access — see What each role can do.",
};

export const ROLE_LABELS: Record<InvitableRole, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

/** The effective capability set for a tier. Admin is locked-full (ADR-0049), so it is
 *  every band unioned — never a stored row. */
export function capabilitiesForRole(role: InvitableRole, perms: PermissionsView): Capability[] {
  if (role === "admin") return inCatalogOrder([...perms.alwaysOn, ...perms.editable, ...perms.adminLocked]);
  return inCatalogOrder(perms.effective[role]);
}

/** TM-08: what a move from `from` to `to` takes away, in matrix order. A demotion is
 *  defined by the SETS, not by tier rank — a tenant may have granted its viewers more
 *  than its members, and the warning must tell that truth. */
export function capabilitiesLost(
  from: InvitableRole,
  to: InvitableRole,
  perms: PermissionsView,
): Capability[] {
  const next = new Set(capabilitiesForRole(to, perms));
  return capabilitiesForRole(from, perms).filter((c) => !next.has(c));
}
