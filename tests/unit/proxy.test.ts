import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Drive supabase.auth.getUser() via a plain mutable closure, NOT vi.fn: vi.fn records each call's
// return value, and a recorded rejected promise trips Vitest's unhandled-rejection detector even
// though the proxy DOES catch it (verified: proxy returns a 307 redirect, never re-throws a 4xx).
// A closure sidesteps the false positive while still letting each test choose getUser's behavior.
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

import { proxy, isEndedSessionError } from "@/proxy";

// Shape of the AuthApiError @supabase/ssr throws when a refresh token is expired/rotated — the
// marker + status are what the classifier keys on (verified against the real Vercel Sentry event).
function authApiError(status: number, code = "refresh_token_not_found"): Error {
  return Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), {
    __isAuthError: true,
    status,
    code,
  });
}
const dashboard = () => new NextRequest(new URL("https://app.test/dashboard"));

beforeEach(() => {
  state.getUser = async () => ({ data: { user: null } });
});

describe("isEndedSessionError: only a 4xx Supabase auth error is a benign ended session", () => {
  it("ADR-0032: a 4xx auth error (expired/rotated refresh token) is benign", () => {
    expect(isEndedSessionError(authApiError(400))).toBe(true);
    expect(isEndedSessionError(authApiError(401))).toBe(true);
  });
  it("ADR-0032: a 5xx auth error, a non-auth error, or a non-error is NOT benign (must surface)", () => {
    expect(isEndedSessionError(authApiError(503))).toBe(false); // Supabase token endpoint down
    expect(isEndedSessionError(new Error("network down"))).toBe(false);
    expect(isEndedSessionError({ status: 400 })).toBe(false); // lacks the __isAuthError marker
    expect(isEndedSessionError(null)).toBe(false);
  });
});

describe("proxy: getUser() failure handling (ADR-0032 — keep benign session-ends out of Sentry)", () => {
  it("ADR-0032: an expired refresh token redirects to login instead of throwing a 500", async () => {
    state.getUser = async () => {
      throw authApiError(400);
    };
    const res = await proxy(dashboard());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("ADR-0032: a 5xx Supabase auth error is re-thrown (a real outage stays visible)", async () => {
    state.getUser = async () => {
      throw authApiError(503);
    };
    await expect(proxy(dashboard())).rejects.toThrow();
  });

  it("ADR-0032: a non-auth error is re-thrown", async () => {
    state.getUser = async () => {
      throw new Error("token endpoint unreachable");
    };
    await expect(proxy(dashboard())).rejects.toThrow();
  });

  it("AUT-13: a valid session passes through with no-store, no redirect", async () => {
    state.getUser = async () => ({ data: { user: { id: "u1" } } });
    const res = await proxy(dashboard());
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
