import { describe, it, expect, vi } from "vitest";

// ADR-0036: control the master key deterministically.
vi.mock("@/lib/env", () => ({ env: { AI_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } }));

import { encryptSecret, decryptSecret, isEncryptionConfigured } from "@/lib/crypto/secret-box";

describe("ADR-0036: secret-box AES-256-GCM envelope", () => {
  it("reports encryption configured when a valid 32-byte key is set", () => {
    expect(isEncryptionConfigured()).toBe(true);
  });

  it("round-trips a secret and never stores it in plaintext", () => {
    const secret = "sk-live-abc123-DEF456-the-provider-key";
    const blob = encryptSecret(secret);
    expect(blob).toMatch(/^v1\./);
    expect(blob).not.toContain(secret);
    expect(decryptSecret(blob)).toBe(secret);
  });

  it("uses a fresh nonce so the same secret encrypts to different ciphertext", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const blob = encryptSecret("tamper-me");
    const parts = blob.split(".");
    // Flip a byte in the ciphertext segment.
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
