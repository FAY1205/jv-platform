import { randomInt } from "node:crypto";
import { sha256Hex } from "./hash";
import { timingSafeEqualStr } from "./constant-time";

// PTL-01: partner login is a 6-digit email OTP (possession-based; partners never
// have passwords). The code is stored only as a hash; verification is constant-time
// (AUT-09) with an expiry check.

export const OTP_TTL_MS = 10 * 60_000; // 10 minutes

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(code: string, pepper: string): string {
  return sha256Hex(`${pepper}:${code}`);
}

export interface OtpChallenge {
  codeHash: string;
  expiresAt: number;
  pepper: string;
}

export function issueOtp(pepper: string, now: number, ttlMs: number = OTP_TTL_MS): {
  code: string;
  challenge: OtpChallenge;
} {
  const code = generateOtp();
  return { code, challenge: { codeHash: hashOtp(code, pepper), expiresAt: now + ttlMs, pepper } };
}

export function verifyOtp(input: string, challenge: OtpChallenge, now: number): boolean {
  if (now > challenge.expiresAt) return false;
  return timingSafeEqualStr(hashOtp(input, challenge.pepper), challenge.codeHash);
}
