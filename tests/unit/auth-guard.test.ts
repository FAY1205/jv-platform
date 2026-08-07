import { describe, it, expect } from "vitest";
import { requireAdminResponse, authErrorResponse } from "@/lib/auth/guard";
import { UnauthenticatedError, NotProvisionedError } from "@/lib/scope-context";
import type { ScopeContext } from "@/lib/scope";

// PRN-08 / API-01 (audit R-13): the shared admin-route gate and the scope-failure→HTTP
// mapping are used by 35+/57+ routes but had zero DIRECT tests. If requireAdminResponse
// ever returned null unconditionally (letting partners into admin APIs), nothing failed.
const admin: ScopeContext = { tenantId: "t1", role: "admin", userId: "u1" };
const partner: ScopeContext = { tenantId: "t1", role: "partner", userId: "u2", partnerId: "p1" };

describe("PRN-08: requireAdminResponse", () => {
  it("PRN-08: admin scope passes the gate (returns null)", () => {
    expect(requireAdminResponse(admin)).toBeNull();
  });

  it("PRN-08: partner scope is rejected 403", async () => {
    const res = requireAdminResponse(partner);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.json()).toMatchObject({ code: "forbidden" });
  });
});

describe("API-01: authErrorResponse maps scope failures to the uniform envelope", () => {
  it("API-01: an unauthenticated session maps to 401", async () => {
    const res = authErrorResponse(new UnauthenticatedError());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    expect(await res!.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("API-01: an authenticated-but-unprovisioned session maps to 403", async () => {
    const res = authErrorResponse(new NotProvisionedError("no membership"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.json()).toMatchObject({ code: "forbidden" });
  });

  it("API-01: an unrelated error is not swallowed (returns null so the route 500s)", () => {
    expect(authErrorResponse(new Error("boom"))).toBeNull();
  });
});
