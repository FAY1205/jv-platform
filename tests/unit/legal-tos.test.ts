import { describe, it, expect } from "vitest";
import { needsTosAcceptance, CURRENT_TOS_VERSION } from "@/lib/legal/tos";

// LGL-01: acceptance required at first login and again on a material change (a new
// version). Pure gate over the user's last-accepted version.
describe("LGL-01: ToS acceptance gate", () => {
  it("requires acceptance when the user has never accepted", () => {
    expect(needsTosAcceptance(null)).toBe(true);
  });

  it("requires re-acceptance when the accepted version is stale", () => {
    expect(needsTosAcceptance("2000-01-01")).toBe(true);
  });

  it("does not require acceptance when the current version is already accepted", () => {
    expect(needsTosAcceptance(CURRENT_TOS_VERSION)).toBe(false);
  });
});
