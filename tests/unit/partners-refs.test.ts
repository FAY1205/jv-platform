import { describe, expect, it } from "vitest";
import { nextPartnerNumber } from "@/modules/partners/refs";

// ADM-03 / DM-07: new partners get the next monotonic PR-### (numbering derives from
// the max, never the count). Legacy JV-### refs (pre-migration-0022 environments)
// must still advance the sequence so a rename can never mint a colliding number.
describe("nextPartnerNumber", () => {
  it("PARTNERS-REF-01: starts at 1 for an empty tenant", () => {
    expect(nextPartnerNumber([])).toBe(1);
  });

  it("PARTNERS-REF-02: continues from the maximum, not the count", () => {
    // A deactivated PR-005 may have dropped from the roster — never reuse its number.
    expect(nextPartnerNumber(["PR-001", "PR-002", "PR-009"])).toBe(10);
  });

  it("PARTNERS-REF-03: ignores malformed refs and is order-independent", () => {
    expect(nextPartnerNumber(["PR-003", "garbage", "PR-011", "PR-007"])).toBe(12);
  });

  it("PARTNERS-REF-04: legacy JV-### refs advance the sequence too (rename safety)", () => {
    expect(nextPartnerNumber(["JV-001", "JV-009", "PR-004"])).toBe(10);
  });
});
