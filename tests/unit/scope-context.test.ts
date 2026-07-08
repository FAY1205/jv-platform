import { describe, it, expect } from "vitest";
import {
  resolveScope,
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
});
