import { describe, it, expect, vi, beforeEach } from "vitest";

// C-3 / SEC-09 (pr-reviewer F-2): the change-password route's infra-outage branch (`ok === undefined`,
// i.e. the re-auth signInWithPassword THREW) used to return a bare 503 with no log and no Retry-After —
// a silent failure on an authenticated path (ADR-0014). It now mirrors login: capture the throw and
// return `jsonServiceUnavailable`, so an outage is logged (correlated traceId) and carries Retry-After.

const { logError, signInWithPassword, getUser, settle } = vi.hoisted(() => ({
  logError: vi.fn(),
  signInWithPassword: vi.fn(),
  getUser: vi.fn().mockResolvedValue({ data: { user: { email: "admin@x.test" } } }),
  settle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/observability", () => ({ logError }));
vi.mock("@/lib/auth/guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/guard")>()),
  assertCsrf: () => true,
}));
vi.mock("@/lib/scope-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scope-context")>()),
  getServerScope: async () => ({ tenantId: "t", role: "admin", userId: "u" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: async () => ({ auth: { getUser, signInWithPassword } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
// Empty rate windows (attempts/ipAttempts) → rateDecisionWithSelf admits; the infra branch is what we test.
vi.mock("@/lib/auth/attempts-store", () => ({
  AuthAttemptsStore: class {
    reserve() {
      return Promise.resolve("attempt-id");
    }
    snapshot() {
      return Promise.resolve({ attempts: [], ipAttempts: [], failures: [] });
    }
    settle(...args: unknown[]) {
      return settle(...args);
    }
  },
}));

import { POST as changePassword } from "@/app/api/auth/change-password/route";

const ORIGIN = "http://localhost";
function post(body: unknown): Request {
  return new Request(`${ORIGIN}/api/auth/change-password`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  logError.mockClear();
  settle.mockClear();
  signInWithPassword.mockReset();
});

describe("C-3/SEC-09: change-password auth-outage availability", () => {
  it("C-3/SEC-09 (audit F-2): an auth-backend outage returns a floored 503 + Retry-After and is LOGGED (not a silent 503)", async () => {
    signInWithPassword.mockRejectedValueOnce(new Error("supabase down"));
    const res = await changePassword(post({ currentPassword: "old", newPassword: "NewLongPassphrase!42" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    // The PII-scrubbed fault is logged sharing the response's correlated traceId (F-42) — no longer silent.
    expect(logError).toHaveBeenCalledWith(
      "password_change_unavailable",
      expect.objectContaining({ message: "supabase down" }),
      expect.any(String),
    );
  });
});
