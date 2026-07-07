import { randomBytes } from "node:crypto";
import { sha256Hex } from "./hash";
import { timingSafeEqualStr } from "./constant-time";

// AUT-06: password reset uses a single-use token, hashed at rest, 30-minute expiry.
// On successful reset the caller revokes all sessions and emails the owner. The
// token secret is returned once (to email); only its hash is stored.

export const RESET_TTL_MS = 30 * 60_000;

export interface ResetTokenRecord {
  userId: string;
  tokenHash: string;
  expiresAt: number;
  usedAt?: number;
}

export function issueResetToken(
  userId: string,
  now: number,
): { token: string; record: ResetTokenRecord } {
  const token = randomBytes(32).toString("base64url");
  return { token, record: { userId, tokenHash: sha256Hex(token), expiresAt: now + RESET_TTL_MS } };
}

export type ResetVerifyReason = "used" | "expired" | "mismatch";

export function verifyResetToken(
  input: string,
  record: ResetTokenRecord,
  now: number,
): { ok: boolean; reason?: ResetVerifyReason } {
  if (record.usedAt != null) return { ok: false, reason: "used" };
  if (now > record.expiresAt) return { ok: false, reason: "expired" };
  if (!timingSafeEqualStr(sha256Hex(input), record.tokenHash)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
