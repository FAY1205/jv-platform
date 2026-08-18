import { describe, it, expect } from "vitest";
import { issueTeamInviteToken, verifyTeamInviteToken, TEAM_INVITE_TTL_MS } from "@/lib/auth/team-invite";
import { sha256Hex } from "@/lib/auth/hash";

// Phase C: the staff-invite token primitives (AUT-09 constant-time verify; single-use;
// 7-day TTL). The route/module tests cover the flows; this pins the pure verdicts.

describe("TM-20: team-invite token issue/verify", () => {
  const NOW = 1_700_000_000_000;

  it("TM-20: issue returns a hash matching the token and a TTL-anchored expiry", () => {
    const { token, tokenHash, expiresAt } = issueTeamInviteToken(NOW);
    expect(tokenHash).toBe(sha256Hex(token));
    expect(expiresAt.getTime()).toBe(NOW + TEAM_INVITE_TTL_MS);
    expect(token.length).toBeGreaterThanOrEqual(40); // 32 random bytes, base64url
  });

  it("TM-20: a live token verifies; used/revoked/expired/mismatch are refused with reasons", () => {
    const { token, tokenHash, expiresAt } = issueTeamInviteToken(NOW);
    const base = { tokenHash, expiresAt, acceptedAt: null, revokedAt: null };
    expect(verifyTeamInviteToken(token, base, NOW + 1000)).toEqual({ ok: true });
    expect(verifyTeamInviteToken(token, { ...base, acceptedAt: new Date(NOW) }, NOW + 1000)).toEqual({ ok: false, reason: "used" });
    expect(verifyTeamInviteToken(token, { ...base, revokedAt: new Date(NOW) }, NOW + 1000)).toEqual({ ok: false, reason: "revoked" });
    expect(verifyTeamInviteToken(token, base, NOW + TEAM_INVITE_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
    expect(verifyTeamInviteToken("not-the-token", base, NOW + 1000)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("TM-20: two issues never share a token or hash (single-use by construction)", () => {
    const a = issueTeamInviteToken(NOW);
    const b = issueTeamInviteToken(NOW);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});
