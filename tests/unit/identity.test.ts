import { describe, it, expect } from "vitest";
import { initialsFromEmail } from "@/lib/identity";

// WS-7: avatar initials for the profile menu + Profile settings (users have no name
// column yet, so identity is derived from the email local-part).
describe("initialsFromEmail", () => {
  it("takes the first two dot/sep-separated words of the local part", () => {
    expect(initialsFromEmail("john.doe@example.com")).toBe("JD");
    expect(initialsFromEmail("a_b_c@x.io")).toBe("AB");
  });

  it("falls back to a single letter for a one-word local part", () => {
    expect(initialsFromEmail("admin@acme.test")).toBe("A");
  });

  it("uppercases the result", () => {
    expect(initialsFromEmail("faisal@yahoo.com")).toBe("F");
  });

  it("returns a stable placeholder for an empty/odd value", () => {
    expect(initialsFromEmail("")).toBe("?");
  });
});
