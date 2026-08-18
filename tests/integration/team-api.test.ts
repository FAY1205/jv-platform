import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";
import { purgeAuditLog } from "../helpers/audit";

// ─────────────────────────────────────────────────────────────────────────────
// Phase C team management (TM-03..TM-13 + ADR-0049): the /api/admin/team surface
// end-to-end at the HTTP layer — real DB, seam-injected scopes, stubbed Supabase
// Admin (role changes/deactivations sync auth metadata; no live auth project here).
// The OWNER invariants are the point: only the workspace owner touches admin
// seats; nobody touches the owner; nobody touches themselves.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({ auth: { admin: { updateUserById } } }),
}));

import { GET as teamGet } from "@/app/api/admin/team/route";
import { POST as invitePost } from "@/app/api/admin/team/invites/route";
import { POST as resendPost, DELETE as revokeDelete } from "@/app/api/admin/team/invites/[id]/route";
import { PATCH as rolePatch } from "@/app/api/admin/team/members/[userId]/route";
import { POST as deactivatePost } from "@/app/api/admin/team/members/[userId]/deactivate/route";
import { POST as reactivatePost } from "@/app/api/admin/team/members/[userId]/reactivate/route";
import { GET as permsGet, PATCH as permsPatch } from "@/app/api/admin/team/permissions/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-team-api";

suite("TM: team management API", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  let ownerId: string;
  let adminId: string;
  let memberId: string;

  const scopeFor = (userId: string, role: ScopeContext["role"]): ScopeContext => ({ tenantId, role, userId });

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.update(schema.tenants).set({ ownerUserId: null }).where(inArray(schema.tenants.id, tids));
    await db.delete(schema.teamInvites).where(inArray(schema.teamInvites.tenantId, tids));
    await db.delete(schema.roleCapabilities).where(inArray(schema.roleCapabilities.tenantId, tids));
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Team API", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    ownerId = randomUUID();
    adminId = randomUUID();
    memberId = randomUUID();
    await db.insert(schema.users).values([
      { id: ownerId, tenantId, email: "owner@team.test", role: "admin" },
      { id: adminId, tenantId, email: "admin@team.test", role: "admin" },
      { id: memberId, tenantId, email: "member@team.test", role: "member" },
    ]);
    await db.update(schema.tenants).set({ ownerUserId: ownerId }).where(eq(schema.tenants.id, tenantId));
  });

  afterAll(async () => {
    await cleanup();
    setRouteScope(null);
  });

  it("TM-01: the roster lists staff seats with the owner flagged, and open invites", async () => {
    setRouteScope(scopeFor(adminId, "admin"));
    const res = await teamGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ownerUserId).toBe(ownerId);
    expect(body.members.map((m: { email: string }) => m.email).sort()).toEqual([
      "admin@team.test",
      "member@team.test",
      "owner@team.test",
    ]);
    expect(body.members.find((m: { id: string }) => m.id === ownerId).isOwner).toBe(true);
  });

  it("TM-13: a member scope is 403'd from every team surface (team.manage is admin-locked)", async () => {
    setRouteScope(scopeFor(memberId, "member"));
    expect((await teamGet()).status).toBe(403);
    expect((await invitePost(jsonRequest("POST", "/api/admin/team/invites", { email: "x@y.test", role: "viewer" }))).status).toBe(403);
    expect((await permsGet()).status).toBe(403);
  });

  it("TM-03: invite → duplicate-member and duplicate-invite are 409; a fresh invite lands", async () => {
    setRouteScope(scopeFor(adminId, "admin"));
    const dupMember = await invitePost(jsonRequest("POST", "/api/admin/team/invites", { email: "member@team.test", role: "viewer" }));
    expect(dupMember.status).toBe(409);
    const fresh = await invitePost(jsonRequest("POST", "/api/admin/team/invites", { email: "newcomer@team.test", role: "viewer" }));
    expect(fresh.status).toBe(200);
    const dupInvite = await invitePost(jsonRequest("POST", "/api/admin/team/invites", { email: "newcomer@team.test", role: "viewer" }));
    expect(dupInvite.status).toBe(409);
  });

  it("TM-05/OQ-1: a non-owner admin cannot grant the ADMIN role; the workspace owner can", async () => {
    setRouteScope(scopeFor(adminId, "admin"));
    const denied = await invitePost(jsonRequest("POST", "/api/admin/team/invites", { email: "second-admin@team.test", role: "admin" }));
    expect(denied.status).toBe(403);
    setRouteScope(scopeFor(ownerId, "admin"));
    const allowed = await invitePost(jsonRequest("POST", "/api/admin/team/invites", { email: "second-admin@team.test", role: "admin" }));
    expect(allowed.status).toBe(200);
  });

  it("TM-03: resend is throttled to one/minute; revoke kills the invite", async () => {
    setRouteScope(scopeFor(adminId, "admin"));
    const [invite] = await db
      .select({ id: schema.teamInvites.id })
      .from(schema.teamInvites)
      .where(and(eq(schema.teamInvites.tenantId, tenantId), eq(schema.teamInvites.email, "newcomer@team.test")));
    // Immediately after creation the issue-time throttle refuses a resend.
    const throttled = await resendPost(jsonRequest("POST", `/api/admin/team/invites/${invite.id}`, {}), routeParams({ id: invite.id }));
    expect(throttled.status).toBe(429);
    const revoked = await revokeDelete(jsonRequest("DELETE", `/api/admin/team/invites/${invite.id}`), routeParams({ id: invite.id }));
    expect(revoked.status).toBe(200);
    const [row] = await db.select({ revokedAt: schema.teamInvites.revokedAt }).from(schema.teamInvites).where(eq(schema.teamInvites.id, invite.id));
    expect(row.revokedAt).not.toBeNull();
    // A revoked invite is no longer resendable.
    const dead = await resendPost(jsonRequest("POST", `/api/admin/team/invites/${invite.id}`, {}), routeParams({ id: invite.id }));
    expect(dead.status).toBe(404);
  });

  it("TM-07: self role-change is refused; TM-06: the owner's seat is immutable to everyone", async () => {
    setRouteScope(scopeFor(adminId, "admin"));
    const self = await rolePatch(jsonRequest("PATCH", `/api/admin/team/members/${adminId}`, { role: "member" }), routeParams({ userId: adminId }));
    expect(self.status).toBe(409);
    expect((await self.json()).code).toBe("self_change_forbidden");
    setRouteScope(scopeFor(ownerId, "admin"));
    const ownSeat = await rolePatch(jsonRequest("PATCH", `/api/admin/team/members/${ownerId}`, { role: "member" }), routeParams({ userId: ownerId }));
    expect(ownSeat.status).toBe(409); // self-action fires first — still refused
    setRouteScope(scopeFor(adminId, "admin"));
    const ownerSeat = await rolePatch(jsonRequest("PATCH", `/api/admin/team/members/${ownerId}`, { role: "member" }), routeParams({ userId: ownerId }));
    expect(ownerSeat.status).toBe(409);
    expect((await ownerSeat.json()).code).toBe("owner_immutable");
  });

  it("TM-05: only the owner changes an ADMIN's role; an admin manages member/viewer seats", async () => {
    setRouteScope(scopeFor(ownerId, "admin"));
    const demote = await rolePatch(jsonRequest("PATCH", `/api/admin/team/members/${adminId}`, { role: "member" }), routeParams({ userId: adminId }));
    expect(demote.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(adminId, { app_metadata: { tenant_id: tenantId, role: "member" } });
    const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, adminId));
    expect(row.role).toBe("member");
    // A (non-owner) admin CAN move member↔viewer… but adminId is now a member; promote back as owner
    const promoteBack = await rolePatch(jsonRequest("PATCH", `/api/admin/team/members/${adminId}`, { role: "admin" }), routeParams({ userId: adminId }));
    expect(promoteBack.status).toBe(200);
    // …and a non-owner admin changing another member's tier (viewer) passes:
    setRouteScope(scopeFor(adminId, "admin"));
    const tierMove = await rolePatch(jsonRequest("PATCH", `/api/admin/team/members/${memberId}`, { role: "viewer" }), routeParams({ userId: memberId }));
    expect(tierMove.status).toBe(200);
    const back = await rolePatch(jsonRequest("PATCH", `/api/admin/team/members/${memberId}`, { role: "member" }), routeParams({ userId: memberId }));
    expect(back.status).toBe(200);
  });

  it("TM-09..11: deactivate refuses self and the owner; deactivates a member; reactivate restores", async () => {
    setRouteScope(scopeFor(adminId, "admin"));
    expect((await deactivatePost(jsonRequest("POST", `/api/admin/team/members/${adminId}/deactivate`, {}), routeParams({ userId: adminId }))).status).toBe(409);
    expect((await deactivatePost(jsonRequest("POST", `/api/admin/team/members/${ownerId}/deactivate`, {}), routeParams({ userId: ownerId }))).status).toBe(409);
    const ok = await deactivatePost(jsonRequest("POST", `/api/admin/team/members/${memberId}/deactivate`, {}), routeParams({ userId: memberId }));
    expect(ok.status).toBe(200);
    const [row] = await db.select({ deactivatedAt: schema.users.deactivatedAt }).from(schema.users).where(eq(schema.users.id, memberId));
    expect(row.deactivatedAt).not.toBeNull();
    const re = await reactivatePost(jsonRequest("POST", `/api/admin/team/members/${memberId}/reactivate`, {}), routeParams({ userId: memberId }));
    expect(re.status).toBe(200);
    const [after] = await db.select({ deactivatedAt: schema.users.deactivatedAt }).from(schema.users).where(eq(schema.users.id, memberId));
    expect(after.deactivatedAt).toBeNull();
  });

  it("ADR-0049: permissions GET reflects defaults; PATCH grants an editable cap; locked key 400s; reset deletes the row", async () => {
    setRouteScope(scopeFor(adminId, "admin"));
    const before = await (await permsGet()).json();
    expect(before.configured).toEqual({ member: false, viewer: false });
    expect(before.effective.viewer).toEqual(["leads.read", "views.own"]);

    const grant = await permsPatch(jsonRequest("PATCH", "/api/admin/team/permissions", { viewer: ["data.export"] }));
    expect(grant.status).toBe(200);
    const granted = await grant.json();
    expect(granted.configured.viewer).toBe(true);
    expect(granted.effective.viewer).toEqual(["data.export", "leads.read", "views.own"]);

    const locked = await permsPatch(jsonRequest("PATCH", "/api/admin/team/permissions", { viewer: ["team.manage"] }));
    expect(locked.status).toBe(400);

    const reset = await permsPatch(jsonRequest("PATCH", "/api/admin/team/permissions", { viewer: null }));
    expect(reset.status).toBe(200);
    const restored = await reset.json();
    expect(restored.configured.viewer).toBe(false);
    expect(restored.effective.viewer).toEqual(["leads.read", "views.own"]);
  });

  it("ACT-04: seat mutations land in the audit trail", async () => {
    const actions = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tenantId, tenantId));
    const set = new Set(actions.map((a) => a.action));
    for (const expected of ["team.invite_sent", "team.invite_revoked", "team.role_changed", "team.member_deactivated", "team.member_reactivated", "team.permissions_changed"]) {
      expect(set.has(expected), expected).toBe(true);
    }
  });
});
