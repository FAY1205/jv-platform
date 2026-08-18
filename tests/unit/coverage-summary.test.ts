import { describe, expect, it } from "vitest";
import { coverageSummary } from "@/lib/coverage-summary";

// UXF-10.2 (Scope-E audit §10.2): the partner roster's Coverage cell. A zero count is the
// ABSENCE of a coverage kind, not a fact worth printing — "0 ZIPs · 2 states" read as a
// defect on the live page.
describe("UXF-10.2: coverage summary", () => {
  it("UXF-10.2: omits a zero ZIP segment — a state-only partner reads '2 states'", () => {
    expect(coverageSummary(0, 2)).toBe("2 states");
  });

  it("UXF-10.2: omits a zero state segment — a ZIP-only partner reads '14 ZIPs'", () => {
    expect(coverageSummary(14, 0)).toBe("14 ZIPs");
  });

  it("UXF-10.2: no coverage at all reads as an em dash, never '0 ZIPs · 0 states'", () => {
    expect(coverageSummary(0, 0)).toBe("—");
  });

  it("UXF-10.2: both kinds present keep the middot-joined pair", () => {
    expect(coverageSummary(14, 2)).toBe("14 ZIPs · 2 states");
  });

  it("UXF-10.2: each segment is singularized independently", () => {
    expect(coverageSummary(1, 1)).toBe("1 ZIP · 1 state");
    expect(coverageSummary(1, 3)).toBe("1 ZIP · 3 states");
    expect(coverageSummary(3, 1)).toBe("3 ZIPs · 1 state");
  });
});
