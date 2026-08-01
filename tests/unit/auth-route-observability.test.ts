import { describe, it, expect, vi, beforeEach } from "vitest";

// WP-SU-19 (SEC-05 / ADR-0032): the three uniform-timing auth routes (login, otp/request,
// reset/request) run their side-effecting work inside `withUniformTiming`, which SWALLOWS any throw
// into the timing floor (enumeration.ts) — so an infra fault (e.g. a misconfigured email transport
// throwing inside notifyOtp, or a DB fault) used to vanish with no log and no Sentry event, and
// SU-10's onRequestError never fired either (the throw never propagates). This wires each work body
// to capture the fault via `logError` (PII-scrubbed, forwarded to Sentry by the observability seam)
// while leaving the response byte-identical — the routes must STILL return their uniform response
// (200 for otp/reset, 401 for login), because surfacing a 500 on these paths would leak account
// existence (the send only runs for real accounts) and break AUT-05.

const { logError, settle, ipFailureCount, signInWithPassword } = vi.hoisted(() => ({
  logError: vi.fn(),
  settle: vi.fn().mockResolvedValue(undefined),
  ipFailureCount: vi.fn().mockResolvedValue(0),
  signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/lib/observability", () => ({ logError }));
vi.mock("@/lib/auth/guard", () => ({ assertCsrf: () => true }));
vi.mock("@/lib/auth/attempts-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/attempts-store")>()),
  AuthAttemptsStore: class {
    reserve() {
      return Promise.resolve("attempt-id");
    }
    snapshot() {
      return Promise.resolve({ failures: [], attempts: [], ipAttempts: [] });
    }
    settle(...args: unknown[]) {
      return settle(...args);
    }
    ipFailureCount(...args: unknown[]) {
      return ipFailureCount(...args);
    }
  },
}));
// getDb: a chainable stub whose user lookup resolves to [] (no partner) so the happy-path work
// bodies return early without touching OtpStore/notify.
vi.mock("@/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: async () => ({ auth: { signInWithPassword } }),
}));

import { POST as otpRequest } from "@/app/api/auth/otp/request/route";
import { POST as resetRequest } from "@/app/api/auth/reset/request/route";
import { POST as login } from "@/app/api/auth/login/route";

const ORIGIN = "http://localhost";
function post(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  logError.mockClear();
  settle.mockReset().mockResolvedValue(undefined);
  ipFailureCount.mockReset().mockResolvedValue(0);
  signInWithPassword.mockReset().mockResolvedValue({ error: null });
});

// WP-SU-20 evolves the login case: an infra fault there is no longer masqueraded as a 401 credential
// failure that feeds the AUT-04 lockout ladder — it returns a floored 500 and is not settled as a
// failure (an outage must not lock out a legitimate admin). otp/request & reset/request keep WP-SU-19's
// log-only behaviour (a distinct status there would leak account existence — AUT-05).
describe("WP-SU-19/20: auth-route infra-fault handling (observability + login availability)", () => {
  it("AUT-05/ADR-0032: an infra fault inside otp/request is logged and the response stays uniform (200)", async () => {
    settle.mockRejectedValueOnce(new Error("db down")); // stands in for any throw in the work body
    const res = await otpRequest(post("/api/auth/otp/request", { email: "who@x.test" }));
    expect(res.status).toBe(200); // AUT-05: uniform response is unchanged
    expect(logError).toHaveBeenCalledWith("otp_request_failed", expect.objectContaining({ message: "db down" }));
  });

  it("AUT-05/ADR-0032: an infra fault inside reset/request is logged and the response stays uniform (200)", async () => {
    settle.mockRejectedValueOnce(new Error("db down"));
    const res = await resetRequest(post("/api/auth/reset/request", { email: "who@x.test" }));
    expect(res.status).toBe(200);
    expect(logError).toHaveBeenCalledWith("reset_request_failed", expect.objectContaining({ message: "db down" }));
  });

  it("WP-SU-20/AUT-04: a login infra fault returns a floored 500 (not a 401), is logged, and does NOT feed the lockout ladder", async () => {
    signInWithPassword.mockRejectedValueOnce(new Error("supabase down"));
    const res = await login(post("/api/auth/login", { email: "who@x.test", password: "pw" }));
    // Availability: an auth-backend outage is not a wrong password — a distinct 500, not the 401
    // masquerade this route returned before WP-SU-20. AUT-05-safe: login's throw is account-independent.
    expect(res.status).toBe(500);
    // Logged via jsonServerError: the PII-scrubbed fault sharing the response's correlated traceId (F-42).
    expect(logError).toHaveBeenCalledWith(
      "login_unavailable",
      expect.objectContaining({ message: "supabase down" }),
      expect.any(String),
    );
    // AUT-04: the infra fault must NOT be settled as a credential failure. The reservation already
    // stands as a success:true row (rate-yes, lockout-no); this path deliberately does not settle again.
    expect(settle).not.toHaveBeenCalled();
  });

  it("WP-SU-20/AUT-04: a wrong password still returns 401 and feeds the lockout ladder (unchanged)", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: "invalid" } });
    const res = await login(post("/api/auth/login", { email: "who@x.test", password: "pw" }));
    expect(res.status).toBe(401); // genuine credential failure — behaviour preserved
    expect(settle).toHaveBeenCalledWith("attempt-id", false); // feeds the AUT-04 lockout ladder
    expect(logError).not.toHaveBeenCalled(); // not an infra fault — nothing logged
  });

  it("ADR-0032: a healthy otp/request logs nothing (the catch does not fire spuriously)", async () => {
    const res = await otpRequest(post("/api/auth/otp/request", { email: "who@x.test" }));
    expect(res.status).toBe(200);
    expect(logError).not.toHaveBeenCalled();
  });

  it("ADR-0032: a healthy reset/request logs nothing", async () => {
    const res = await resetRequest(post("/api/auth/reset/request", { email: "who@x.test" }));
    expect(res.status).toBe(200);
    expect(logError).not.toHaveBeenCalled();
  });

  it("ADR-0032: a healthy login (valid credentials) logs nothing and returns 200", async () => {
    const res = await login(post("/api/auth/login", { email: "who@x.test", password: "pw" }));
    expect(res.status).toBe(200);
    expect(logError).not.toHaveBeenCalled();
  });
});
