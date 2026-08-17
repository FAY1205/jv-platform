import { describe, it, expect, vi, beforeEach } from "vitest";

// C-34 (SEC-09 availability): establishSessionForEmail returns a tri-state OUTCOME ({status, detail})
// so the OTP-verify and trust-refresh routes can answer a transient auth-backend outage with a
// retryable 503 + Retry-After (mirroring login/change-password) instead of a blanket 500, AND log the
// diagnostic ONCE at the route with the response traceId (F-42) rather than emitting an uncorrelated
// line here. The OTP/trust token is already valid by the time this runs, so a failure is never the
// caller's fault — it splits into "unavailable" (a backend call errored or threw → retryable) and
// "failed" (a clean response with no usable token → non-retryable). This proves the classification;
// the route mapping (503/500 + shared-traceId log) is covered by auth-session-availability.test.ts.

const { generateLink, verifyOtp } = vi.hoisted(() => ({
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({ auth: { admin: { generateLink } } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: async () => ({ auth: { verifyOtp } }),
}));

import { establishSessionForEmail } from "@/lib/auth/otp-session";

const token = { data: { properties: { hashed_token: "tok-hash" } }, error: null };
const noToken = { data: { properties: {} }, error: null };

beforeEach(() => {
  generateLink.mockReset();
  verifyOtp.mockReset();
});

describe("C-34/SEC-09: establishSessionForEmail tri-state", () => {
  it("returns 'established' when a token is minted and verifyOtp succeeds", async () => {
    generateLink.mockResolvedValue(token);
    verifyOtp.mockResolvedValue({ error: null });
    expect(await establishSessionForEmail("p@x.test")).toMatchObject({ status: "established" });
  });

  it("returns 'unavailable' when generateLink returns an error (retryable backend fault)", async () => {
    generateLink.mockResolvedValue({ data: null, error: { message: "service role rejected" } });
    const out = await establishSessionForEmail("p@x.test");
    expect(out.status).toBe("unavailable");
    expect(out.detail).toContain("service role rejected"); // detail flows to the caller for the F-42 log
  });

  it("returns 'unavailable' when verifyOtp returns an error on every type", async () => {
    generateLink.mockResolvedValue(token);
    verifyOtp.mockResolvedValue({ error: { message: "token type mismatch" } });
    expect((await establishSessionForEmail("p@x.test")).status).toBe("unavailable");
  });

  it("returns 'unavailable' when a backend call THROWS (network/transport outage)", async () => {
    generateLink.mockRejectedValue(new Error("ECONNRESET"));
    const out = await establishSessionForEmail("p@x.test");
    expect(out.status).toBe("unavailable");
    expect(out.detail).toContain("ECONNRESET");
  });

  it("returns 'failed' when the backend answers cleanly but hands back no token (non-retryable)", async () => {
    // No error, no hashed_token on either type — a contract/config fault, not a transient outage.
    generateLink.mockResolvedValue(noToken);
    expect((await establishSessionForEmail("p@x.test")).status).toBe("failed");
  });

  it("returns 'unavailable' when ANY attempt hits a real backend error, even if another only lacked a token (F-2)", async () => {
    // Mixed cause: first type errors (real backend fault), second returns clean-but-empty. A single
    // real error/throw in either attempt is enough to call the whole thing retryable — documenting
    // the deliberate OR semantics (the "no token" branch alone would have been "failed").
    generateLink
      .mockResolvedValueOnce({ data: null, error: { message: "backend blip" } })
      .mockResolvedValueOnce(noToken);
    expect((await establishSessionForEmail("p@x.test")).status).toBe("unavailable");
  });
});
