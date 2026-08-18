import { randomBytes } from "node:crypto";
import { sha256Hex } from "./hash";
import { timingSafeEqualStr } from "./constant-time";

// Phase C (ADR-0049 / team-page-spec): staff invite tokens — the signup-token pattern
// (single-use, SHA-256 hash at rest, constant-time verify, AUT-09) with a 7-day window
// (an invite is a colleague onboarding step, not a security challenge; resend re-issues).
// The plaintext token exists only in the emailed link; the row stores the hash.

export const TEAM_INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

/** The tiers a teammate can be invited AS. Owner is never invitable; partner is the
 *  other stream (Partners page). Zod re-validates at every boundary. */
export const INVITABLE_ROLES = ["admin", "member", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function issueTeamInviteToken(now: number): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256Hex(token), expiresAt: new Date(now + TEAM_INVITE_TTL_MS) };
}

export type TeamInviteRejectReason = "used" | "revoked" | "expired" | "mismatch";

export interface TeamInviteRecord {
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/** Pure verdict on a presented token vs a stored invite row (AUT-09 constant-time). */
export function verifyTeamInviteToken(
  input: string,
  record: TeamInviteRecord,
  now: number,
): { ok: boolean; reason?: TeamInviteRejectReason } {
  if (record.acceptedAt != null) return { ok: false, reason: "used" };
  if (record.revokedAt != null) return { ok: false, reason: "revoked" };
  if (now > record.expiresAt.getTime()) return { ok: false, reason: "expired" };
  if (!timingSafeEqualStr(sha256Hex(input), record.tokenHash)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
