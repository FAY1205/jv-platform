import { describe, it, expect } from "vitest";
import {
  resolveScope,
  subjectFromClaims,
  UnauthenticatedError,
  NotProvisionedError,
} from "@/lib/scope-context";

// WP-023 (AUT-13 / TST-12): getServerScope verifies the session then maps the
// authenticated user to a ScopeContext via the authoritative `users` row. The
// pure mapping is `resolveScope`; the impure wrapper (getUser + DB) wires it.
describe("TST-12: resolveScope — session → scope", () => {
  const uid = "11111111-1111-1111-1111-111111111111";
  const tid = "22222222-2222-2222-2222-222222222222";
  const pid = "33333333-3333-3333-3333-333333333333";

  it("AUT-13: no authenticated user → UnauthenticatedError", () => {
    expect(() => resolveScope(null, null)).toThrow(UnauthenticatedError);
  });

  it("maps an admin user to an admin scope from the users row", () => {
    const scope = resolveScope({ id: uid }, { tenantId: tid, role: "admin", partnerId: null });
    expect(scope).toEqual({ tenantId: tid, role: "admin", userId: uid });
  });

  it("maps a partner user to a partner scope carrying partnerId", () => {
    const scope = resolveScope({ id: uid }, { tenantId: tid, role: "partner", partnerId: pid });
    expect(scope).toEqual({ tenantId: tid, role: "partner", userId: uid, partnerId: pid });
  });

  it("authenticated but not provisioned (no users row) → NotProvisionedError", () => {
    expect(() => resolveScope({ id: uid }, null)).toThrow(NotProvisionedError);
  });

  it("PRN-08: a partner row missing partnerId is refused (never an unscoped partner)", () => {
    expect(() =>
      resolveScope({ id: uid }, { tenantId: tid, role: "partner", partnerId: null }),
    ).toThrow(NotProvisionedError);
  });

  it("SCP-01: a non-partner row carrying a partner_id is refused (corrupt link, not guessed)", () => {
    for (const role of ["admin", "member", "viewer"] as const) {
      expect(() =>
        resolveScope({ id: uid }, { tenantId: tid, role, partnerId: pid }),
      ).toThrow(NotProvisionedError);
    }
  });

  it("SCP-01: member/viewer rows with no partner link resolve to an admin-stream scope", () => {
    for (const role of ["member", "viewer"] as const) {
      expect(resolveScope({ id: uid }, { tenantId: tid, role, partnerId: null })).toEqual({
        tenantId: tid,
        role,
        userId: uid,
      });
    }
  });

  it("AUTHZ: an unrecognized role value is refused, never mapped to a scope", () => {
    expect(() =>
      resolveScope({ id: uid }, { tenantId: tid, role: "owner" as never, partnerId: null }),
    ).toThrow(NotProvisionedError);
  });

  it("PTL-01: a revoked partner is refused a session", () => {
    expect(() =>
      resolveScope({ id: uid }, { tenantId: tid, role: "partner", partnerId: pid }, { status: "revoked", deletedAt: null }),
    ).toThrow(NotProvisionedError);
  });

  it("a soft-deleted partner is refused a session", () => {
    expect(() =>
      resolveScope({ id: uid }, { tenantId: tid, role: "partner", partnerId: pid }, { status: "active", deletedAt: new Date() }),
    ).toThrow(NotProvisionedError);
  });

  it("an active partner resolves normally", () => {
    const scope = resolveScope(
      { id: uid },
      { tenantId: tid, role: "partner", partnerId: pid },
      { status: "active", deletedAt: null },
    );
    expect(scope).toEqual({ tenantId: tid, role: "partner", userId: uid, partnerId: pid });
  });
});

// WP-PERF-AUTH (C-42): identity now comes from the LOCALLY-verified access-token claim (sub),
// via getClaims. subjectFromClaims is the pure guard between "getClaims result" and "trusted uid"
// — it is what rejects an invalid/expired token and what refuses to invent an id (the spoofing
// fence: it reads ONLY the verified `sub`, never a header). See docs/audit/2026-08-18-double-jwt-verify.md.
describe("WP-PERF-AUTH: subjectFromClaims — verified claim → user id", () => {
  const sub = "44444444-4444-4444-4444-444444444444";

  it("returns the verified sub when getClaims succeeded", () => {
    expect(subjectFromClaims({ claims: { sub } }, null)).toBe(sub);
  });

  it("throws Unauthenticated when getClaims returned an error (bad signature / expired / rejected fallback)", () => {
    expect(() => subjectFromClaims({ claims: { sub } }, new Error("Invalid JWT signature"))).toThrow(UnauthenticatedError);
  });

  it("throws Unauthenticated for a null result (no session)", () => {
    expect(() => subjectFromClaims(null, null)).toThrow(UnauthenticatedError);
    expect(() => subjectFromClaims(undefined, null)).toThrow(UnauthenticatedError);
  });

  it("throws Unauthenticated when the claim has no usable sub (never invents an id)", () => {
    expect(() => subjectFromClaims({ claims: null }, null)).toThrow(UnauthenticatedError);
    expect(() => subjectFromClaims({ claims: {} }, null)).toThrow(UnauthenticatedError);
    expect(() => subjectFromClaims({ claims: { sub: "" } }, null)).toThrow(UnauthenticatedError);
    expect(() => subjectFromClaims({ claims: { sub: 123 } }, null)).toThrow(UnauthenticatedError);
  });
});
