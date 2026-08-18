import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import {
  ALWAYS_ON,
  TENANT_EDITABLE,
  ADMIN_LOCKED,
  DEFAULT_TIER_CAPABILITIES,
  effectiveCapabilities,
  type Capability,
} from "@/lib/authz";
import { issueTeamInviteToken, TEAM_INVITE_TTL_MS, type InvitableRole } from "@/lib/auth/team-invite";
import { workspaceOwnerId } from "@/lib/auth/workspace-owner";
import type { PermissionsPatch } from "./schema";
import { logError } from "@/lib/observability";

// ─────────────────────────────────────────────────────────────────────────────
// Team management (Phase C, ADR-0049 / team-page-spec). The STAFF axis only —
// partners live on the Partners page. Every read/write is tenant-scoped through
// lib/scope builders (PRN-08); the route gates on team.manage (admin-locked), and
// the two OWNER invariants live HERE, not in the matrix: only the workspace owner
// touches admin seats (grant admin / change an admin's role / deactivate an
// admin), and NOBODY touches the owner. Self-actions are refused (actor ≠ target).
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** ~100 years — the Supabase Admin API has no "forever" ban; "none" lifts it. */
const PERMANENT_BAN_DURATION = "876000h";

export class TeamTargetNotFoundError extends Error {
  constructor() {
    super("That person isn't on your team.");
    this.name = "TeamTargetNotFoundError";
  }
}
/** TM-07/TM-10: no self role-change or self-deactivation — ever. */
export class SelfActionError extends Error {
  constructor() {
    super("You can't change your own seat.");
    this.name = "SelfActionError";
  }
}
/** TM-02/TM-06/TM-11: the workspace owner's seat is immutable to everyone. */
export class OwnerImmutableError extends Error {
  constructor() {
    super("The workspace owner's seat can't be changed here.");
    this.name = "OwnerImmutableError";
  }
}
/** TM-05/OQ-1: only the workspace owner manages admin seats or grants the admin role. */
export class OwnerOnlyError extends Error {
  constructor() {
    super("Only the workspace owner can manage admin seats.");
    this.name = "OwnerOnlyError";
  }
}
export class DuplicateSeatError extends Error {
  constructor(kind: "member" | "invite") {
    super(
      kind === "member"
        ? "That email is already a member of this workspace."
        : "That email already has a pending invite — resend it from the roster.",
    );
    this.name = "DuplicateSeatError";
  }
}
/** Resend throttle: an invite's issue time is derivable (expiresAt − TTL); one resend/min. */
export class ResendThrottledError extends Error {
  constructor() {
    super("That invite was just sent — try again in a minute.");
    this.name = "ResendThrottledError";
  }
}
/** The role-change auth-metadata sync failed — surfaced loudly (ADR-0049 §3.3), never
 *  swallowed: the DB row committed, so the caller retries the SYNC, not the change. */
export class RoleSyncFailedError extends Error {
  constructor() {
    super("The role changed but session metadata didn't sync — retry the change.");
    this.name = "RoleSyncFailedError";
  }
}

export interface TeamMemberView {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  isOwner: boolean;
  deactivatedAt: string | null;
  joinedAt: string;
}
export interface TeamInviteView {
  id: string;
  email: string;
  role: string;
  invitedByEmail: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

/** The roster: staff seats + open invites (accepted/revoked drop out). */
export async function listTeam(db: DB, scope: ScopeContext, now = new Date()) {
  const ownerId = await workspaceOwnerId(db, scope);
  const members = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
      deactivatedAt: schema.users.deactivatedAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(and(tenantWhere(schema.users, scope), ne(schema.users.role, "partner")))
    .orderBy(asc(schema.users.createdAt));
  const inviter = schema.users;
  const invites = await db
    .select({
      id: schema.teamInvites.id,
      email: schema.teamInvites.email,
      role: schema.teamInvites.role,
      invitedByEmail: inviter.email,
      createdAt: schema.teamInvites.createdAt,
      expiresAt: schema.teamInvites.expiresAt,
    })
    .from(schema.teamInvites)
    .leftJoin(inviter, eq(inviter.id, schema.teamInvites.invitedByUserId))
    .where(
      and(
        tenantWhere(schema.teamInvites, scope),
        isNull(schema.teamInvites.acceptedAt),
        isNull(schema.teamInvites.revokedAt),
      ),
    )
    .orderBy(asc(schema.teamInvites.createdAt));
  return {
    ownerUserId: ownerId,
    members: members.map(
      (m): TeamMemberView => ({
        id: m.id,
        email: m.email,
        role: m.role as TeamMemberView["role"],
        isOwner: m.id === ownerId,
        deactivatedAt: m.deactivatedAt ? m.deactivatedAt.toISOString() : null,
        joinedAt: m.createdAt.toISOString(),
      }),
    ),
    invites: invites.map(
      (i): TeamInviteView => ({
        id: i.id,
        email: i.email,
        role: i.role,
        invitedByEmail: i.invitedByEmail,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
        expired: i.expiresAt.getTime() < now.getTime(),
      }),
    ),
  };
}

/** TM-05/OQ-1 in one place: touching an ADMIN seat (as target or as the new role)
 *  requires the caller to be the workspace owner. */
async function requireOwnerForAdminSeat(
  db: DB,
  scope: ScopeContext,
  involvesAdmin: boolean,
): Promise<void> {
  if (!involvesAdmin) return;
  const owner = await workspaceOwnerId(db, scope);
  if (owner === null || owner !== scope.userId) throw new OwnerOnlyError();
}

/** Create an invite; returns the ONE-TIME token for the email link (never stored). */
export async function createInvite(
  db: DB,
  scope: ScopeContext,
  input: { email: string; role: InvitableRole },
  now = Date.now(),
): Promise<{ inviteId: string; token: string }> {
  await requireOwnerForAdminSeat(db, scope, input.role === "admin");
  const [existingMember] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(tenantWhere(schema.users, scope), eq(schema.users.email, input.email)));
  if (existingMember) throw new DuplicateSeatError("member");
  const [openInvite] = await db
    .select({ id: schema.teamInvites.id })
    .from(schema.teamInvites)
    .where(
      and(
        tenantWhere(schema.teamInvites, scope),
        eq(schema.teamInvites.email, input.email),
        isNull(schema.teamInvites.acceptedAt),
        isNull(schema.teamInvites.revokedAt),
      ),
    );
  if (openInvite) throw new DuplicateSeatError("invite");
  const { token, tokenHash, expiresAt } = issueTeamInviteToken(now);
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.teamInvites)
      .values({
        tenantId: scope.tenantId,
        email: input.email,
        role: input.role,
        tokenHash,
        invitedByUserId: scope.userId,
        expiresAt,
      })
      .returning({ id: schema.teamInvites.id });
    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "team.invite_sent",
      entityType: "team_invite",
      entityRef: inserted[0].id,
      before: null,
      after: { email: input.email, role: input.role },
      traceId: null,
    });
    return inserted;
  });
  return { inviteId: row.id, token };
}

/** Re-issue the link (new token, fresh expiry). Old link dies with the old hash. */
export async function resendInvite(
  db: DB,
  scope: ScopeContext,
  inviteId: string,
  now = Date.now(),
): Promise<{ email: string; role: string; token: string }> {
  const [invite] = await db
    .select({
      id: schema.teamInvites.id,
      email: schema.teamInvites.email,
      role: schema.teamInvites.role,
      expiresAt: schema.teamInvites.expiresAt,
    })
    .from(schema.teamInvites)
    .where(
      and(
        tenantWhere(schema.teamInvites, scope),
        eq(schema.teamInvites.id, inviteId),
        isNull(schema.teamInvites.acceptedAt),
        isNull(schema.teamInvites.revokedAt),
      ),
    );
  if (!invite) throw new TeamTargetNotFoundError();
  await requireOwnerForAdminSeat(db, scope, invite.role === "admin");
  // Issue time = expiresAt − TTL (no extra column): resend at most once a minute.
  const issuedAt = invite.expiresAt.getTime() - TEAM_INVITE_TTL_MS;
  if (now - issuedAt < 60_000) throw new ResendThrottledError();
  const { token, tokenHash, expiresAt } = issueTeamInviteToken(now);
  await db
    .update(schema.teamInvites)
    .set({ tokenHash, expiresAt })
    .where(and(tenantWhere(schema.teamInvites, scope), eq(schema.teamInvites.id, inviteId)));
  return { email: invite.email, role: invite.role, token };
}

export async function revokeInvite(db: DB, scope: ScopeContext, inviteId: string): Promise<void> {
  const [invite] = await db
    .select({ id: schema.teamInvites.id, role: schema.teamInvites.role, email: schema.teamInvites.email })
    .from(schema.teamInvites)
    .where(
      and(
        tenantWhere(schema.teamInvites, scope),
        eq(schema.teamInvites.id, inviteId),
        isNull(schema.teamInvites.acceptedAt),
        isNull(schema.teamInvites.revokedAt),
      ),
    );
  if (!invite) throw new TeamTargetNotFoundError();
  await requireOwnerForAdminSeat(db, scope, invite.role === "admin");
  await db.transaction(async (tx) => {
    await tx
      .update(schema.teamInvites)
      .set({ revokedAt: new Date() })
      .where(and(tenantWhere(schema.teamInvites, scope), eq(schema.teamInvites.id, inviteId)));
    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "team.invite_revoked",
      entityType: "team_invite",
      entityRef: inviteId,
      before: { email: invite.email, role: invite.role },
      after: null,
      traceId: null,
    });
  });
}

/** Resolve a STAFF target seat in the caller's tenant, with the shared invariants. */
async function resolveTarget(db: DB, scope: ScopeContext, userId: string) {
  if (userId === scope.userId) throw new SelfActionError();
  const [target] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
      deactivatedAt: schema.users.deactivatedAt,
    })
    .from(schema.users)
    .where(and(tenantWhere(schema.users, scope), eq(schema.users.id, userId), ne(schema.users.role, "partner")));
  if (!target) throw new TeamTargetNotFoundError();
  const owner = await workspaceOwnerId(db, scope);
  if (owner !== null && owner === target.id) throw new OwnerImmutableError();
  return target;
}

/**
 * Change a seat's role. DB row first (enforcement binds next request via
 * getServerScope's live read), then the auth app_metadata sync — FAIL-LOUD on sync
 * failure (ADR-0049 §3.3): a silently stale 'admin' claim on a demotion would leave the
 * read-only PostgREST surface over-granting until JWT refresh. No session revocation:
 * the scope degrades on the target's next request regardless.
 */
export async function changeRole(
  admin: SupabaseClient,
  db: DB,
  scope: ScopeContext,
  userId: string,
  newRole: InvitableRole,
  traceId?: string,
): Promise<void> {
  const target = await resolveTarget(db, scope, userId);
  await requireOwnerForAdminSeat(db, scope, target.role === "admin" || newRole === "admin");
  // Skip ONLY the DB write when unchanged — the metadata sync below always runs (idempotent),
  // so the documented recovery for a failed sync ("retry the change") actually re-syncs
  // instead of no-opping on the already-committed row (pr-reviewer F-1).
  if (target.role !== newRole) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ role: newRole })
        .where(and(tenantWhere(schema.users, scope), eq(schema.users.id, userId)));
      await tx.insert(schema.auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: scope.userId,
        action: "team.role_changed",
        entityType: "user",
        entityRef: userId,
        before: { role: target.role },
        after: { role: newRole },
        traceId: traceId ?? null,
      });
    });
  }
  const sync = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { tenant_id: scope.tenantId, role: newRole },
  });
  if (sync.error) {
    // The root cause must reach ops (pr-reviewer F-3): jsonError never logs, and the
    // discarded Supabase message is the only diagnostic for a Tier-A metadata desync.
    logError("team_role_sync_failed", { userId, tenantId: scope.tenantId, message: sync.error.message }, traceId);
    throw new RoleSyncFailedError();
  }
}

/** Deactivate: scope refusal is immediate (resolveScope reads the row per request);
 *  trusted-device families are revoked and the auth user banned so refresh dies too. */
export async function deactivateMember(
  admin: SupabaseClient,
  db: DB,
  scope: ScopeContext,
  userId: string,
  deps: { revokeAllForUser: (userId: string, now: number) => Promise<void> },
  traceId?: string,
): Promise<void> {
  const target = await resolveTarget(db, scope, userId);
  await requireOwnerForAdminSeat(db, scope, target.role === "admin");
  if (target.deactivatedAt != null) return;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ deactivatedAt: sql`now()` })
      .where(and(tenantWhere(schema.users, scope), eq(schema.users.id, userId)));
    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "team.member_deactivated",
      entityType: "user",
      entityRef: userId,
      before: { role: target.role },
      after: null,
      traceId: traceId ?? null,
    });
  });
  // Best-effort session teardown (AUT-14 spirit): the scope refusal above is the real
  // enforcement — the seat IS deactivated once the transaction committed. Teardown failures
  // are LOGGED, never allowed to bubble into a dishonest "could not deactivate" 500
  // (pr-reviewer F-4/F-5).
  const devicesRevoked = await deps
    .revokeAllForUser(userId, Date.now())
    .then(() => true)
    .catch((e) => {
      logError("team_deactivate_device_revoke_failed", { userId, message: e instanceof Error ? e.message : String(e) }, traceId);
      return false;
    });
  const banned = await admin.auth.admin
    .updateUserById(userId, { ban_duration: PERMANENT_BAN_DURATION })
    .then((r) => !r.error)
    .catch(() => false);
  if (!devicesRevoked || !banned) {
    logError("team_deactivate_teardown_incomplete", { userId, devicesRevoked, banned }, traceId);
  }
}

export async function reactivateMember(
  admin: SupabaseClient,
  db: DB,
  scope: ScopeContext,
  userId: string,
  traceId?: string,
): Promise<void> {
  const target = await resolveTarget(db, scope, userId);
  await requireOwnerForAdminSeat(db, scope, target.role === "admin");
  if (target.deactivatedAt == null) return;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ deactivatedAt: null })
      .where(and(tenantWhere(schema.users, scope), eq(schema.users.id, userId)));
    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "team.member_reactivated",
      entityType: "user",
      entityRef: userId,
      before: null,
      after: { role: target.role },
      traceId: traceId ?? null,
    });
  });
  await admin.auth.admin
    .updateUserById(userId, { ban_duration: "none" })
    .catch((e) => logError("team_reactivate_unban_failed", { userId, message: e instanceof Error ? e.message : String(e) }, traceId));
}

// ── ADR-0049: the tenant permissions editor ──

export interface PermissionsView {
  defaults: Record<"member" | "viewer", Capability[]>;
  effective: Record<"member" | "viewer", Capability[]>;
  /** Whether a stored row exists per tier (drives "Reset to defaults" affordance). */
  configured: Record<"member" | "viewer", boolean>;
  editable: Capability[];
  alwaysOn: Capability[];
  adminLocked: Capability[];
}

const CONFIGURABLE_TIERS = ["member", "viewer"] as const;

export async function getPermissions(db: DB, scope: ScopeContext): Promise<PermissionsView> {
  const rows = await db
    .select({ role: schema.roleCapabilities.role, capabilities: schema.roleCapabilities.capabilities })
    .from(schema.roleCapabilities)
    .where(tenantWhere(schema.roleCapabilities, scope));
  const stored = new Map(rows.map((r) => [r.role, r.capabilities]));
  const view = (tier: "member" | "viewer") =>
    [...effectiveCapabilities(tier, stored.get(tier) ?? null)].sort();
  return {
    defaults: {
      member: [...DEFAULT_TIER_CAPABILITIES.member].sort(),
      viewer: [...DEFAULT_TIER_CAPABILITIES.viewer].sort(),
    },
    effective: { member: view("member"), viewer: view("viewer") },
    configured: { member: stored.has("member"), viewer: stored.has("viewer") },
    editable: [...TENANT_EDITABLE].sort(),
    alwaysOn: [...ALWAYS_ON].sort(),
    adminLocked: [...ADMIN_LOCKED].sort(),
  };
}

/** Declarative swap per tier; `null` resets the tier to live defaults (row DELETE).
 *  Zod already refused locked/unknown keys (loud 400); the stored array is the
 *  EDITABLE selection only — ALWAYS_ON is re-unioned at read time. */
export async function updatePermissions(
  db: DB,
  scope: ScopeContext,
  patch: PermissionsPatch,
  traceId?: string,
): Promise<PermissionsView> {
  const before = await getPermissions(db, scope);
  // The audit `after` records what was PERSISTED per tier (deduped/sorted, or null for a
  // reset), never the raw client patch (pr-reviewer F-6).
  const persisted: Record<string, string[] | null | undefined> = {};
  await db.transaction(async (tx) => {
    for (const tier of CONFIGURABLE_TIERS) {
      const value = patch[tier];
      if (value === undefined) continue;
      if (value === null) {
        persisted[tier] = null;
        await tx
          .delete(schema.roleCapabilities)
          .where(and(tenantWhere(schema.roleCapabilities, scope), eq(schema.roleCapabilities.role, tier)));
      } else {
        const cleaned = [...new Set(value)].sort();
        persisted[tier] = cleaned;
        await tx
          .insert(schema.roleCapabilities)
          .values({ tenantId: scope.tenantId, role: tier, capabilities: cleaned, updatedAt: sql`now()` })
          .onConflictDoUpdate({
            target: [schema.roleCapabilities.tenantId, schema.roleCapabilities.role],
            set: { capabilities: cleaned, updatedAt: sql`now()` },
          });
      }
    }
    const after = { member: persisted.member, viewer: persisted.viewer };
    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "team.permissions_changed",
      entityType: "role_capabilities",
      entityRef: scope.tenantId,
      before: { member: before.effective.member, viewer: before.effective.viewer, configured: before.configured },
      after,
      traceId: traceId ?? null,
    });
  });
  return getPermissions(db, scope);
}
