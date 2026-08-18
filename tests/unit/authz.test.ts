import { describe, it, expect } from "vitest";
import { can, capabilitiesOf, requireCapabilityResponse, type Capability } from "@/lib/authz";
import { requireAdminResponse } from "@/lib/auth/guard";
import type { ScopeContext } from "@/lib/scope";

// Phase C / WP-ROLE-1: the capability seam. The full role × capability matrix is pinned
// table-driven so any drift in TIER_CAPABILITIES is a visible diff here, and the legacy
// requireAdminResponse gate is proven FAIL-CLOSED for the new tiers (member/viewer 403 on
// every un-migrated admin route by construction).

const scopes: Record<string, ScopeContext> = {
  admin: { tenantId: "t1", role: "admin", userId: "u1" },
  member: { tenantId: "t1", role: "member", userId: "u2" },
  viewer: { tenantId: "t1", role: "viewer", userId: "u3" },
  partner: { tenantId: "t1", role: "partner", userId: "u4", partnerId: "p1" },
};

const ALL_CAPS: Capability[] = [
  "leads.read", "leads.write", "work.write", "views.own", "ingest.run", "runs.void",
  "data.export", "rules.manage", "partners.manage", "settings.manage", "ai.use",
  "team.manage", "ops.admin",
];

// The authoritative expectation (role-model-recommendation §2.3; owner defaults:
// member gets ingest.run + ai.use, no void/export; viewer read-only, no AI).
const EXPECTED: Record<string, Capability[]> = {
  admin: ALL_CAPS,
  member: ["leads.read", "leads.write", "work.write", "views.own", "ingest.run", "ai.use"],
  viewer: ["leads.read", "views.own"],
  partner: [],
};

describe("AUTHZ-01: the role × capability matrix", () => {
  for (const [role, scope] of Object.entries(scopes)) {
    it(`AUTHZ-01: ${role} holds exactly its matrix row`, () => {
      const held = ALL_CAPS.filter((cap) => can(scope, cap));
      expect(held).toEqual(EXPECTED[role]);
      expect(capabilitiesOf(scope)).toEqual(EXPECTED[role]);
    });
  }

  it("AUTHZ-01: a partner scope holds NO capability (stream, not tier)", () => {
    for (const cap of ALL_CAPS) expect(can(scopes.partner, cap)).toBe(false);
  });
});

describe("AUTHZ-02: requireCapabilityResponse gate", () => {
  it("AUTHZ-02: passes (null) when the capability is held", () => {
    expect(requireCapabilityResponse(scopes.viewer, "leads.read")).toBeNull();
  });

  it("AUTHZ-02: 403s with the uniform forbidden envelope when not held", async () => {
    const res = requireCapabilityResponse(scopes.viewer, "runs.void");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.json()).toMatchObject({ code: "forbidden" });
  });
});

describe("AUTHZ-03: the legacy admin gate is fail-closed for the new tiers", () => {
  it("AUTHZ-03: member and viewer 403 on requireAdminResponse (un-migrated routes stay admin-only)", async () => {
    for (const role of ["member", "viewer", "partner"] as const) {
      const res = requireAdminResponse(scopes[role]);
      expect(res, role).not.toBeNull();
      expect(res!.status).toBe(403);
    }
    expect(requireAdminResponse(scopes.admin)).toBeNull();
  });
});
