import { describe, it, expect } from "vitest";
import { issueOtp, OTP_TTL_MS } from "@/lib/auth/otp";
import { otpOutcome } from "@/lib/auth/otp-verify";

// PTL-01 / AUT-09: partner email-OTP verify decision — composes the constant-time
// code check (otp.ts) with expiry, single-use, and an attempt cap. Pure.
describe("PTL-01: OTP verify outcome", () => {
  const now = 1_000_000;
  const { code, challenge } = issueOtp("pepper-x", now);
  const fresh = { ...challenge, attemptCount: 0 };
  const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, "0");

  it("accepts the correct code on a fresh challenge", () => {
    expect(otpOutcome(fresh, code, now, 5)).toBe("ok");
  });

  it("reports a wrong code", () => {
    expect(otpOutcome(fresh, wrongCode, now, 5)).toBe("wrong");
  });

  it("reports an expired challenge", () => {
    expect(otpOutcome(fresh, code, now + OTP_TTL_MS + 1, 5)).toBe("expired");
  });

  it("reports a consumed (single-use) challenge", () => {
    expect(otpOutcome({ ...fresh, consumedAt: now }, code, now, 5)).toBe("consumed");
  });

  it("reports too_many once the attempt cap is reached (even with the right code)", () => {
    expect(otpOutcome({ ...fresh, attemptCount: 5 }, code, now, 5)).toBe("too_many");
  });
});
