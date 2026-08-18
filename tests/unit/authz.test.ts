import { describe, it, expect } from "vitest";
import {
  can,
  capabilitiesOf,
  requireCapabilityResponse,
  requirePassthroughResponse,
  effectiveCapabilities,
  ALWAYS_ON,
  TENANT_EDITABLE,
  ADMIN_LOCKED,
  type Capability,
} from "@/lib/authz";
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

describe("AUTHZ-05: tenant-configured capabilities override the defaults (member/viewer only)", () => {
  it("AUTHZ-05: a member scope carrying a configured set uses it, not the defaults", () => {
    const configured: ScopeContext = { ...scopes.member, capabilities: new Set(["leads.read", "views.own", "data.export"]) };
    expect(can(configured, "data.export")).toBe(true); // granted beyond the default
    expect(can(configured, "leads.write")).toBe(false); // default revoked by config
    expect(capabilitiesOf(configured)).toEqual(["leads.read", "views.own", "data.export"]);
  });

  it("AUTHZ-05: admin ignores any configured set (locked-full tier)", () => {
    const shrunk: ScopeContext = { ...scopes.admin, capabilities: new Set(["leads.read"]) };
    for (const cap of ALL_CAPS) expect(can(shrunk, cap)).toBe(true);
  });

  it("AUTHZ-05: partner ignores any configured set (stream, not tier)", () => {
    const smuggled: ScopeContext = { ...scopes.partner, capabilities: new Set(ALL_CAPS) };
    for (const cap of ALL_CAPS) expect(can(smuggled, cap)).toBe(false);
  });
});

describe("AUTHZ-07: the three-band split partitions the capability set", () => {
  it("AUTHZ-07: ALWAYS_ON ∪ TENANT_EDITABLE ∪ ADMIN_LOCKED ≡ Capability, pairwise disjoint", () => {
    const union = new Set([...ALWAYS_ON, ...TENANT_EDITABLE, ...ADMIN_LOCKED]);
    expect([...union].sort()).toEqual([...ALL_CAPS].sort());
    expect(ALWAYS_ON.size + TENANT_EDITABLE.size + ADMIN_LOCKED.size).toBe(ALL_CAPS.length);
  });

  it("AUTHZ-07: effectiveCapabilities — null row ⇒ live defaults; stored ⇒ (∩ editable) ∪ always-on", () => {
    expect(effectiveCapabilities("member", null)).toEqual(new Set(EXPECTED.member));
    expect(effectiveCapabilities("viewer", null)).toEqual(new Set(EXPECTED.viewer));
    // A stored row can grant editable caps beyond the defaults…
    const grant = effectiveCapabilities("viewer", ["data.export"]);
    expect(grant.has("data.export")).toBe(true);
    // …but locked and unknown keys are silently STRIPPED, and the always-on floor holds.
    const hostile = effectiveCapabilities("member", ["team.manage", "ops.admin", "settings.manage", "nonsense"]);
    expect([...hostile].sort()).toEqual([...ALWAYS_ON].sort());
    // An empty explicit row = the floor, never less (lockout-proof).
    expect([...effectiveCapabilities("viewer", [])].sort()).toEqual([...ALWAYS_ON].sort());
  });

  it("AUTHZ-07: admin ignores stored config entirely (locked-full)", () => {
    expect(effectiveCapabilities("admin", ["leads.read"])).toEqual(new Set(ALL_CAPS));
  });
});

describe("AUTHZ-08: the ADR-0047 pass-through gate", () => {
  it("AUTHZ-08: a partner passes on scope alone (no capability consulted)", () => {
    expect(requirePassthroughResponse(scopes.partner, "data.export")).toBeNull();
  });

  it("AUTHZ-08: an admin-stream caller must hold the named capability", async () => {
    expect(requirePassthroughResponse(scopes.admin, "data.export")).toBeNull();
    const denied = requirePassthroughResponse(scopes.viewer, "data.export");
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
    expect(requirePassthroughResponse(scopes.member, "leads.read")).toBeNull();
    expect(requirePassthroughResponse(scopes.viewer, "leads.write")).not.toBeNull();
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
