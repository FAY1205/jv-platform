import { verifyOtp, type OtpChallenge } from "./otp";

// PTL-01: the OTP verify decision, pure over the stored challenge state. Composes
// otp.ts's constant-time code check (AUT-09) with single-use, expiry, and an
// attempt cap so a code can't be brute-forced.

export type OtpOutcome = "ok" | "expired" | "wrong" | "too_many" | "consumed";

export interface OtpChallengeState extends OtpChallenge {
  attemptCount: number;
  consumedAt?: number;
}

export function otpOutcome(
  challenge: OtpChallengeState,
  code: string,
  now: number,
  maxAttempts: number,
): OtpOutcome {
  if (challenge.consumedAt != null) return "consumed";
  if (now > challenge.expiresAt) return "expired";
  if (challenge.attemptCount >= maxAttempts) return "too_many";
  return verifyOtp(code, challenge, now) ? "ok" : "wrong";
}
