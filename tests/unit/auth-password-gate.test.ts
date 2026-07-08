import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { evaluateNewPassword } from "@/lib/auth/password";

// AUT-02: setting/changing the admin password enforces length ≥ 12, zxcvbn ≥ 3,
// AND a breach check (HIBP k-anonymity). `evaluateNewPassword` composes the two
// gates; the breach check runs only after the local strength check passes.
describe("AUT-02: new-password gate", () => {
  // A strong, non-dictionary passphrase that zxcvbn scores ≥ 3.
  const STRONG = "quilt-marmot-9-tavern-echo";

  function rangeFetcherThatKnows(passwords: string[]) {
    const suffixes = new Set(
      passwords.map((p) => createHash("sha1").update(p).digest("hex").toUpperCase().slice(5)),
    );
    return async () => [...suffixes].map((s) => `${s}:42`).join("\n");
  }
  const neverBreached = async () => "0000000000000000000000000000000000000:1";

  it("rejects a too-short password before any breach lookup", async () => {
    let called = false;
    const result = await evaluateNewPassword("short1!", [], async () => {
      called = true;
      return "";
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/at least 12/i);
    expect(called).toBe(false); // local gate fails first — no network call
  });

  it("rejects a strong password that appears in a breach corpus", async () => {
    const result = await evaluateNewPassword(STRONG, [], rangeFetcherThatKnows([STRONG]));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ").toLowerCase()).toContain("breach");
  });

  it("accepts a strong, unbreached password", async () => {
    const result = await evaluateNewPassword(STRONG, [], neverBreached);
    expect(result.ok).toBe(true);
  });
});
