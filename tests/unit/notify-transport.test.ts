import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notifyOtp } from "@/lib/auth/notify";

// PTL-01 / NTF-03: the instant auth path (OTP/invite/reset) must actually send via
// Resend in production. It used to hardcode the dev mailbox in EVERY environment, so a
// deployed partner never received their sign-in code — this test is the regression guard.
// SEC-07 is covered by email-transport.test.ts (non-prod never gets Resend); here we prove
// the wiring in production, with env mocked to production + a key.
vi.mock("@/lib/env", () => ({
  env: {
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "JV Platform <noreply@jv.test>",
    EMAIL_SINK_ADDRESS: "sink@non-prod.test",
  },
  isProduction: true,
  adminAllowlist: [],
}));

const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ id: "resend-1" }),
  text: async () => "",
})) as unknown as typeof fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  (fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls.length = 0;
});

afterEach(() => vi.unstubAllGlobals());

describe("PTL-01: instant auth email sends via Resend in production", () => {
  it("notifyOtp posts the code to the Resend API with the configured key and sender", async () => {
    await notifyOtp("partner@real.test", "481920");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");

    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("JV Platform <noreply@jv.test>");
    // In production the SEC-07 guard passes the real recipient through untouched.
    expect(body.to).toEqual(["partner@real.test"]);
    expect(body.text).toContain("481920"); // the actual sign-in code reaches the recipient
  });
});
