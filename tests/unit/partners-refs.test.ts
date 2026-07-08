import { describe, expect, it } from "vitest";
import { nextPartnerNumber } from "@/modules/partners/refs";

// ADM-03 / DM-07: new partners get the next monotonic JV-### (the seed hardcodes
// JV-001..009 without touching ref_counters, so allocation continues from the max).
describe("nextPartnerNumber", () => {
  it("PARTNERS-REF-01: starts at 1 for an empty tenant", () => {
    expect(nextPartnerNumber([])).toBe(1);
  });

  it("PARTNERS-REF-02: continues from the maximum, not the count", () => {
    // A deactivated JV-005 may have dropped from the roster — never reuse its number.
    expect(nextPartnerNumber(["JV-001", "JV-002", "JV-009"])).toBe(10);
  });

  it("PARTNERS-REF-03: ignores malformed refs and is order-independent", () => {
    expect(nextPartnerNumber(["JV-003", "garbage", "JV-011", "JV-007"])).toBe(12);
  });
});
