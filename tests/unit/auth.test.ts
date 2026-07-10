import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  timingSafeEqualStr,
  uniformAuthResponse,
  withUniformTiming,
  lockoutState,
  generateOtp,
  issueOtp,
  verifyOtp,
  checkPasswordStrength,
  isPasswordBreached,
  issueResetToken,
  verifyResetToken,
  InMemoryRefreshStore,
  RefreshTokenService,
} from "@/lib/auth";

describe("AUT-09: constant-time comparison", () => {
  it("matches equal strings and rejects others without leaking length", () => {
    expect(timingSafeEqualStr("abc123", "abc123")).toBe(true);
    expect(timingSafeEqualStr("abc123", "abc124")).toBe(false);
    expect(timingSafeEqualStr("short", "muchlongervalue")).toBe(false);
  });
});

describe("AUT-05: enumeration resistance", () => {
  it("returns an identical response whether or not an account exists", () => {
    expect(uniformAuthResponse()).toEqual(uniformAuthResponse());
  });

  it("pads to a uniform minimum time regardless of work duration", async () => {
    let now = 0;
    const elapsed = () => now;
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    };
    const res = await withUniformTiming(
      100,
      async () => {
        now += 20;
        return "done";
      },
      sleep,
      elapsed,
    );
    expect(res).toBe("done");
    expect(sleeps).toEqual([80]);
  });
});

describe("AUT-04: progressive lockout (never permanent)", () => {
  it("escalates delay after the free attempts and always stays finite", () => {
    expect(lockoutState(4)).toMatchObject({ locked: false });
    expect(lockoutState(5)).toMatchObject({ locked: true, retryAfterMs: 30_000, shouldNotify: true });
    expect(lockoutState(6)).toMatchObject({ locked: true, retryAfterMs: 60_000, shouldNotify: false });
    expect(lockoutState(999).retryAfterMs).toBe(3_600_000); // capped, never infinite
  });
});

describe("AUT-09 / PTL-01: email OTP", () => {
  it("generates a 6-digit code and verifies it constant-time within expiry", () => {
    expect(generateOtp()).toMatch(/^\d{6}$/);
    const { code, challenge } = issueOtp("pepper", 1000);
    expect(verifyOtp(code, challenge, 2000)).toBe(true);
    expect(verifyOtp("000000", challenge, 2000)).toBe(code === "000000");
    expect(verifyOtp(code, challenge, 1000 + 10 * 60_000 + 1)).toBe(false); // expired
  });
});

describe("AUT-02: password strength + breach", () => {
  it("rejects short or weak passwords and accepts strong ones", () => {
    expect(checkPasswordStrength("short").ok).toBe(false);
    expect(checkPasswordStrength("aaaaaaaaaaaa").ok).toBe(false); // 12 chars but trivial
    expect(checkPasswordStrength("correct-horse-battery-staple-9").ok).toBe(true);
  });

  it("detects a breached password via k-anonymity", async () => {
    const pw = "hunter2";
    const suffix = createHash("sha1").update(pw).digest("hex").toUpperCase().slice(5);
    expect(await isPasswordBreached(pw, async () => `${suffix}:42\nAAAA:1`)).toBe(true);
    expect(await isPasswordBreached(pw, async () => "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1")).toBe(false);
  });
});

describe("AUT-06: single-use reset token", () => {
  it("verifies once, then rejects reuse / expiry / mismatch", () => {
    const { token, record } = issueResetToken("user-1", 1000);
    expect(verifyResetToken(token, record, 2000)).toEqual({ ok: true });
    record.usedAt = 2000; // caller marks single-use after success
    expect(verifyResetToken(token, record, 2100)).toEqual({ ok: false, reason: "used" });

    const fresh = issueResetToken("user-1", 1000).record;
    expect(verifyResetToken("wrong", fresh, 2000)).toEqual({ ok: false, reason: "mismatch" });
    const expired = issueResetToken("user-1", 1000);
    expect(verifyResetToken(expired.token, expired.record, 1000 + 30 * 60_000 + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("AUT-10: refresh rotation + reuse detection", () => {
  it("rotates once and revokes the whole family on reuse", () => {
    let n = 0;
    const store = new InMemoryRefreshStore();
    const svc = new RefreshTokenService(store, () => `id-${++n}`);

    const first = svc.issue(1000);
    const rotated = svc.rotate(first.token, 2000);
    expect(rotated.status).toBe("rotated");

    // Presenting the already-rotated original = reuse → family revoked.
    const reuse = svc.rotate(first.token, 3000);
    expect(reuse.status).toBe("reuse_revoked");

    // The successor is now dead too (family revoked) — logout/AUT-14 semantics.
    if (rotated.status === "rotated") {
      expect(svc.rotate(rotated.token, 4000).status).toBe("invalid");
    }
  });
});
