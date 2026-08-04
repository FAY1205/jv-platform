import { randomBytes } from "node:crypto";
import { sha256Hex } from "./hash";
import { timingSafeEqualStr } from "./constant-time";

// SCP-02/AUT-06: signup email-verification uses a single-use token, hashed at
// rest, 24-hour expiry. On successful verification the caller activates the
// account. The token secret is returned once (to email); only its hash is stored.

export const SIGNUP_TTL_MS = 24 * 60 * 60_000;

export interface SignupTokenRecord {
  userId: string;
  tokenHash: string;
  expiresAt: number;
  usedAt?: number;
}

export function issueSignupToken(
  userId: string,
  now: number,
): { token: string; record: SignupTokenRecord } {
  const token = randomBytes(32).toString("base64url");
  return { token, record: { userId, tokenHash: sha256Hex(token), expiresAt: now + SIGNUP_TTL_MS } };
}

export type SignupVerifyReason = "used" | "expired" | "mismatch";

export function verifySignupToken(
  input: string,
  record: SignupTokenRecord,
  now: number,
): { ok: boolean; reason?: SignupVerifyReason } {
  if (record.usedAt != null) return { ok: false, reason: "used" };
  if (now > record.expiresAt) return { ok: false, reason: "expired" };
  if (!timingSafeEqualStr(sha256Hex(input), record.tokenHash)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
