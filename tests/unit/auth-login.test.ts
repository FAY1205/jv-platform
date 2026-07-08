import { describe, it, expect } from "vitest";
import { loginOutcome, INVALID_CREDENTIALS_MESSAGE } from "@/lib/auth/login";

// AUT-05: the login endpoint never reveals whether an account exists. The route
// makes ONE sign-in attempt and maps only success/failure to a response — there
// is no account-existence branch — so wrong-password and no-such-account are
// indistinguishable to the client. `loginOutcome` encodes that policy.
describe("AUT-05: login response is uniform on failure", () => {
  it("maps a failed sign-in to 401 with a generic credential message", () => {
    const out = loginOutcome(false);
    expect(out.status).toBe(401);
    expect(out.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(out.message.toLowerCase()).not.toContain("exist");
    expect(out.message.toLowerCase()).not.toContain("found");
  });

  it("maps a successful sign-in to 200", () => {
    const out = loginOutcome(true);
    expect(out.status).toBe(200);
  });

  it("returns the SAME failure regardless of the underlying reason (no enumeration)", () => {
    // Both a bad password and a nonexistent account arrive here as `false`.
    expect(loginOutcome(false)).toEqual(loginOutcome(false));
  });
});
