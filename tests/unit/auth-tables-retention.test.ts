import { describe, it, expect } from "vitest";
import { OTP_TTL_MS } from "@/lib/auth/otp";
import { RESET_TTL_MS } from "@/lib/auth/reset-token";
import { SIGNUP_TTL_MS } from "@/lib/auth/signup-token";
import {
  AUTH_TABLE_RETENTION_MARGIN_MS,
  OTP_CHALLENGES_RETENTION_MS,
  RESET_TOKENS_RETENTION_MS,
  SIGNUP_VERIFICATIONS_RETENTION_MS,
  otpChallengesCutoff,
  resetTokensCutoff,
  signupVerificationsCutoff,
} from "@/modules/retention/auth-tables";

// WP-SU-13 (ADR-0010): cutoffs are DERIVED from the live TTL constants, never restated. A literal
// (`600000`) passes on the day it is written and silently starts deleting rows a live read still
// uses the moment OTP_TTL_MS moves. These tripwires make that impossible.
describe("WP-SU-13: otp_challenges retention cutoff", () => {
  it("SU-13-OTP-01: retention is the live OTP read window PLUS the shared margin", () => {
    expect(OTP_CHALLENGES_RETENTION_MS).toBe(OTP_TTL_MS + AUTH_TABLE_RETENTION_MARGIN_MS);
  });
  it("SU-13-OTP-02: retention covers the OTP TTL (build-fails if a literal drifts below it)", () => {
    expect(OTP_CHALLENGES_RETENTION_MS).toBeGreaterThanOrEqual(OTP_TTL_MS);
  });
  it("SU-13-MARGIN-01: the shared margin is a generous >= 7 days", () => {
    expect(AUTH_TABLE_RETENTION_MARGIN_MS).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });
  it("SU-13-OTP-03: the cutoff is exactly the retention window before now, and is pure", () => {
    const now = new Date("2026-07-30T03:00:00.000Z");
    expect(otpChallengesCutoff(now).getTime()).toBe(now.getTime() - OTP_CHALLENGES_RETENTION_MS);
    expect(now.toISOString()).toBe("2026-07-30T03:00:00.000Z"); // caller clock never mutated
  });
});

describe("WP-SU-13: reset_tokens retention cutoff", () => {
  it("SU-13-RST-01: retention is the live reset TTL plus the shared margin", () => {
    expect(RESET_TOKENS_RETENTION_MS).toBe(RESET_TTL_MS + AUTH_TABLE_RETENTION_MARGIN_MS);
  });
  it("SU-13-RST-02: retention covers the reset TTL", () => {
    expect(RESET_TOKENS_RETENTION_MS).toBeGreaterThanOrEqual(RESET_TTL_MS);
  });
  it("SU-13-RST-03: the cutoff is exactly the retention window before now", () => {
    const now = new Date("2026-07-30T03:00:00.000Z");
    expect(resetTokensCutoff(now).getTime()).toBe(now.getTime() - RESET_TOKENS_RETENTION_MS);
  });
});

describe("WP-SU-13: signup_verifications retention cutoff", () => {
  it("SU-13-SGN-01: retention is the live signup TTL plus the shared margin", () => {
    expect(SIGNUP_VERIFICATIONS_RETENTION_MS).toBe(SIGNUP_TTL_MS + AUTH_TABLE_RETENTION_MARGIN_MS);
  });
  it("SU-13-SGN-02: retention covers the signup TTL", () => {
    expect(SIGNUP_VERIFICATIONS_RETENTION_MS).toBeGreaterThanOrEqual(SIGNUP_TTL_MS);
  });
  it("SU-13-SGN-03: the cutoff is exactly the retention window before now", () => {
    const now = new Date("2026-07-30T03:00:00.000Z");
    expect(signupVerificationsCutoff(now).getTime()).toBe(now.getTime() - SIGNUP_VERIFICATIONS_RETENTION_MS);
  });
});
