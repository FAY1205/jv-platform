import { describe, it, expect } from "vitest";
import { csrfOk, newCsrfToken } from "@/lib/auth/csrf";

// AUT-12: CSRF = Origin allowlist PLUS a double-submit token on authed state-
// changing routes. `csrfOk` combines both; `newCsrfToken` mints an unguessable
// token for the readable double-submit cookie.
describe("AUT-12: combined CSRF check", () => {
  const allowed = ["https://app.example.com"];
  const good = "https://app.example.com";

  it("passes when Origin is allowed and no token is required (pre-session, e.g. login)", () => {
    expect(csrfOk({ origin: good, allowedOrigins: allowed, requireToken: false })).toBe(true);
  });

  it("passes when Origin is allowed and the double-submit token matches", () => {
    expect(
      csrfOk({ origin: good, allowedOrigins: allowed, requireToken: true, cookieToken: "t1", headerToken: "t1" }),
    ).toBe(true);
  });

  it("fails when the token is required but missing or mismatched", () => {
    expect(csrfOk({ origin: good, allowedOrigins: allowed, requireToken: true, cookieToken: "t1", headerToken: "t2" })).toBe(false);
    expect(csrfOk({ origin: good, allowedOrigins: allowed, requireToken: true })).toBe(false);
  });

  it("fails on a bad Origin regardless of token", () => {
    expect(
      csrfOk({ origin: "https://evil.example", allowedOrigins: allowed, requireToken: true, cookieToken: "t1", headerToken: "t1" }),
    ).toBe(false);
  });

  it("mints distinct, non-trivial tokens", () => {
    const a = newCsrfToken();
    const b = newCsrfToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(24);
  });
});
