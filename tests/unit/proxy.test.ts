import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Drive supabase.auth.getUser() via a plain mutable closure, NOT vi.fn: vi.fn records each call's
// return value, and a recorded rejected promise trips Vitest's unhandled-rejection detector even
// though the proxy DOES catch it (verified: proxy returns a 307 redirect, never re-throws a benign
// session-end). A closure sidesteps the false positive while still letting each test pick behavior.
const state = vi.hoisted(() => ({
  getUser: async (): Promise<{ data: { user: unknown } }> => ({ data: { user: null } }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: () => state.getUser() } }),
}));
vi.mock("@/lib/env", () => ({
  env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon" },
  isProduction: false,
}));
vi.mock("@/lib/auth/csrf-token", () => ({
  newCsrfToken: () => "csrf-token",
  CSRF_COOKIE_NAME: "__Host-jv-csrf",
}));
// Spy on the observability seam so F-3 can assert a public-page outage is still surfaced.
const obs = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/observability", () => ({ logError: obs.logError }));

import { proxy, isEndedSessionError } from "@/proxy";

// Shape of the AuthApiError @supabase/ssr throws — the marker + status + code are what the
// classifier keys on (verified against the real Vercel Sentry event, which threw with
// __isAuthError, status 400, code 'refresh_token_not_found').
function authApiError(status: number, code = "refresh_token_not_found"): Error {
  return Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), {
    __isAuthError: true,
    status,
    code,
  });
}
// AuthSessionMissingError carries no `code`; it is identified by name.
function authSessionMissing(): Error {
  return Object.assign(new Error("Auth session missing!"), {
    __isAuthError: true,
    status: 400,
    name: "AuthSessionMissingError",
  });
}
const req = (path: string) => new NextRequest(new URL(`https://app.test${path}`));

beforeEach(() => {
  state.getUser = async () => ({ data: { user: null } });
  obs.logError.mockClear();
});

describe("isEndedSessionError: only a genuine ended-session error is benign", () => {
  it("ADR-0032: an expired/reused/missing refresh token (4xx + session code) is benign", () => {
    expect(isEndedSessionError(authApiError(400, "refresh_token_not_found"))).toBe(true);
    expect(isEndedSessionError(authApiError(401, "refresh_token_already_used"))).toBe(true);
    expect(isEndedSessionError(authApiError(400, "session_not_found"))).toBe(true);
    expect(isEndedSessionError(authSessionMissing())).toBe(true); // matched by name, no code
  });

  it("ADR-0032 (F-1): an operationally-significant 4xx auth error must NOT be swallowed", () => {
    expect(isEndedSessionError(authApiError(429, "over_request_rate_limit"))).toBe(false); // rate limited
    expect(isEndedSessionError(authApiError(403, "user_banned"))).toBe(false); // banned user
    // Uncoded 4xx auth error — e.g. a bad/revoked SUPABASE_ANON_KEY — must surface, not log everyone out.
    expect(isEndedSessionError(Object.assign(new Error("bad api key"), { __isAuthError: true, status: 401 }))).toBe(false);
  });

  it("ADR-0032: a 5xx auth error, a non-auth error, or a non-error is NOT benign", () => {
    expect(isEndedSessionError(authApiError(503, "refresh_token_not_found"))).toBe(false); // Supabase down
    expect(isEndedSessionError(new Error("network down"))).toBe(false);
    expect(isEndedSessionError({ status: 400, code: "refresh_token_not_found" })).toBe(false); // no __isAuthError
    expect(isEndedSessionError(null)).toBe(false);
  });
});

describe("proxy: getUser() failure handling (ADR-0032 — keep benign session-ends out of Sentry)", () => {
  it("ADR-0032: an expired refresh token redirects an admin page to /login instead of throwing", async () => {
    state.getUser = async () => {
      throw authApiError(400);
    };
    const res = await proxy(req("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("ADR-0032 (F-4): an expired refresh token on a portal page redirects to /portal/login", async () => {
    state.getUser = async () => {
      throw authApiError(400);
    };
    const res = await proxy(req("/portal/leads"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/portal/login");
  });

  it("ADR-0032 (F-4): a benign session-end on a PUBLIC page passes through, not a redirect", async () => {
    state.getUser = async () => {
      throw authApiError(400);
    };
    const res = await proxy(req("/"));
    expect(res.headers.get("location")).toBeNull();
    expect(obs.logError).not.toHaveBeenCalled(); // a benign session-end is quiet, not an outage
  });

  it("ADR-0032 (F-1): a 4xx rate-limit auth error is re-thrown, not silently swallowed", async () => {
    state.getUser = async () => {
      throw authApiError(429, "over_request_rate_limit");
    };
    await expect(proxy(req("/dashboard"))).rejects.toThrow();
  });

  it("ADR-0032: a 5xx Supabase auth error on a PROTECTED page is re-thrown (fail closed + visible)", async () => {
    state.getUser = async () => {
      throw authApiError(503);
    };
    await expect(proxy(req("/dashboard"))).rejects.toThrow();
  });

  it("ADR-0032 (F-3): a Supabase Auth outage on a PUBLIC page renders logged-out + logs, does NOT 500", async () => {
    state.getUser = async () => {
      throw authApiError(503);
    };
    const res = await proxy(req("/")); // must NOT throw — the login/marketing pages stay up
    expect(res.headers.get("location")).toBeNull(); // rendered, not redirected
    expect(obs.logError).toHaveBeenCalledWith("proxy_auth_unavailable", expect.objectContaining({ path: "/" }));
  });

  it("ADR-0032 (F-3): a Supabase Auth outage on /portal/login (a PUBLIC_EXCEPTIONS path under /portal) stays up", async () => {
    // The whole point of the fix: /portal/login lives under the protected /portal prefix but is
    // public (PUBLIC_EXCEPTIONS), and it's the page a partner needs to recover — an outage must not
    // 500 it. Guards the exception's interaction with the outage-degrade branch.
    state.getUser = async () => {
      throw authApiError(503);
    };
    const res = await proxy(req("/portal/login"));
    expect(res.headers.get("location")).toBeNull(); // rendered, not redirected to a login page
    expect(obs.logError).toHaveBeenCalledWith("proxy_auth_unavailable", expect.objectContaining({ path: "/portal/login" }));
  });

  it("ADR-0032: a non-auth error is re-thrown", async () => {
    state.getUser = async () => {
      throw new Error("token endpoint unreachable");
    };
    await expect(proxy(req("/dashboard"))).rejects.toThrow();
  });

  it("AUT-13: a valid session passes through with no-store, no redirect", async () => {
    state.getUser = async () => ({ data: { user: { id: "u1" } } });
    const res = await proxy(req("/dashboard"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  // WP-TSK-5: the admin My Tasks page is a new protected page prefix — pages don't
  // self-guard (API routes do, via getServerScope), so this proxy list is the only gate.
  it("WP-TSK-5: an unauthenticated request to /tasks (new admin prefix) redirects to /login", async () => {
    const res = await proxy(req("/tasks"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("WP-TSK-5: an unauthenticated request to /portal/tasks redirects to /portal/login (already covered by the /portal prefix)", async () => {
    const res = await proxy(req("/portal/tasks"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/portal/login");
  });

  // N3A/C-55: /signup's Terms consent link used to point at /tos — a PROTECTED page — so a
  // prospect reading the terms before creating an account was bounced to /login. The public
  // /terms page fixes that dead end, and it is public by ABSENCE from the allowlist above.
  // These two tests are the guard: a future "tighten the proxy" sweep that adds /terms to
  // PROTECTED_PAGE_PREFIXES re-breaks signup, and this fails.
  it("N3A-02/C-55: /terms is reachable signed-out (public legal page, not in the protected allowlist)", async () => {
    const res = await proxy(req("/terms"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull(); // rendered, not redirected to a login page
  });

  it("N3A-02/C-55: the in-app /tos ACCEPTANCE gate stays protected (only /terms was opened up)", async () => {
    const res = await proxy(req("/tos"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
