import { describe, it, expect, vi, beforeEach } from "vitest";

// WP-PERF-AUTH (C-42): getServerScope now verifies the JWT LOCALLY via getClaims (against a
// module-cached JWKS) instead of a second network getUser(). This pins the wiring the audit
// required: the route uses getClaims (not getUser), reads the tenant/role from the live `users`
// row keyed on the verified `sub`, and rejects a bad token. The integration route harness injects
// scope at the getServerScope seam, so no route suite exercises this path — it lives here.

const uid = "55555555-5555-5555-5555-555555555555";
const tid = "66666666-6666-6666-6666-666666666666";

const getClaims = vi.fn();
const getUser = vi.fn(() => {
  throw new Error("getUser must NOT be called on the local-verify path");
});
// Minimal drizzle-ish builder: select().from().leftJoin().where() resolves to the rows
// array (Phase C: the role_capabilities LEFT JOIN rides the users-row read).
let usersRows: unknown[] = [];
const mockDb = {
  select: () => ({
    from: () => ({
      leftJoin: () => ({ where: () => Promise.resolve(usersRows) }),
      where: () => Promise.resolve(usersRows),
    }),
  }),
};

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServer: async () => ({ auth: { getClaims, getUser } }) }));
vi.mock("@/lib/supabase/jwks", () => ({ getCachedJwks: async () => ({ keys: [{ kid: "k1" }] }) }));
vi.mock("@/db", () => ({ getDb: () => mockDb }));

import { getServerScope, UnauthenticatedError } from "@/lib/scope-context";

beforeEach(() => {
  getClaims.mockReset();
  getUser.mockClear();
  usersRows = [];
});

describe("WP-PERF-AUTH: getServerScope verifies locally (getClaims), never a second getUser", () => {
  it("resolves an admin scope from the verified sub — and does NOT call getUser (no second network verify)", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: uid } }, error: null });
    usersRows = [{ tenantId: tid, role: "admin", partnerId: null }];

    const scope = await getServerScope();

    expect(scope).toEqual({ tenantId: tid, role: "admin", userId: uid });
    // The local-verify win: getClaims was used, the second network getUser was NOT.
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
    // getClaims is handed the cached JWKS so it verifies without fetching per request.
    expect(getClaims.mock.calls[0][1]).toEqual({ jwks: { keys: [{ kid: "k1" }] } });
  });

  it("a getClaims error (bad signature / expired / rejected HS fallback) → UnauthenticatedError", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("Invalid JWT signature") });
    await expect(getServerScope()).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("a verified user with no membership row → NotProvisioned (401/403 envelope upstream)", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: uid } }, error: null });
    usersRows = []; // no users row for this uid
    await expect(getServerScope()).rejects.toThrow(/not provisioned|membership/i);
  });
});
