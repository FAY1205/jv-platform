import { describe, it, expect } from "vitest";
import { issueSignupCode, verifySignupCode, normalizeCode, hashCode, SIGNUP_CODE_TTL_MS } from "@/lib/auth/signup-code";

describe("SCP-06: signup invitation codes", () => {
  const now = 1_760_000_000_000;

  it("issues a formatted, human-typeable code and stores only the hash + 48h expiry", () => {
    const { code, record } = issueSignupCode(now);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/); // Crockford, no I/L/O/U
    expect(record.codeHash).toHaveLength(64); // sha256 hex — plaintext never stored
    expect(record.codeHash).not.toContain(code);
    expect(record.expiresAt).toBe(now + SIGNUP_CODE_TTL_MS);
    expect(SIGNUP_CODE_TTL_MS).toBe(48 * 60 * 60_000);
  });

  it("normalises separators, case, and look-alike typos to one canonical form", () => {
    // dashes/spaces/case ignored; O→0, I/L→1
    expect(normalizeCode("abcd-efgh jklm")).toBe("ABCDEFGHJK1M");
    expect(normalizeCode("O0I1L")).toBe("00111");
    expect(hashCode("ab-cd")).toBe(hashCode("ABCD"));
  });

  it("verifies a matching code and rejects mismatches, expiry, and reuse", () => {
    const { code, record } = issueSignupCode(now);
    // Re-typed with lowercase + spacing must still verify.
    expect(verifySignupCode(code.toLowerCase().replace(/-/g, " "), record, now).ok).toBe(true);
    expect(verifySignupCode("WRONGCODE1234", record, now)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignupCode(code, record, now + SIGNUP_CODE_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
    expect(verifySignupCode(code, { ...record, usedAt: now }, now)).toEqual({ ok: false, reason: "used" });
  });
});
