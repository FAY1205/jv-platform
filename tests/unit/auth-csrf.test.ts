import { describe, it, expect } from "vitest";
import { isAllowedOrigin, csrfTokenMatches } from "@/lib/auth/csrf";

// AUT-12: state-changing routes are CSRF-protected by SameSite=Lax cookies PLUS
// an app-side check. The primary check is a strict Origin allowlist; a
// double-submit token is compared in constant time (AUT-09).
describe("AUT-12: CSRF defenses", () => {
  const allowed = ["https://app.example.com"];

  it("accepts a request whose Origin is an allowed app origin", () => {
    expect(isAllowedOrigin("https://app.example.com", allowed)).toBe(true);
  });

  it("rejects a cross-site Origin", () => {
    expect(isAllowedOrigin("https://evil.example", allowed)).toBe(false);
  });

  it("rejects a missing Origin header (fail closed)", () => {
    expect(isAllowedOrigin(null, allowed)).toBe(false);
  });

  it("AUT-09: double-submit token matches only when both are present and equal", () => {
    expect(csrfTokenMatches("tok-abc-123", "tok-abc-123")).toBe(true);
    expect(csrfTokenMatches("tok-abc-123", "tok-different")).toBe(false);
    expect(csrfTokenMatches(undefined, "tok-abc-123")).toBe(false);
    expect(csrfTokenMatches("tok-abc-123", undefined)).toBe(false);
    expect(csrfTokenMatches("", "")).toBe(false);
  });
});
