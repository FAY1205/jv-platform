import { describe, expect, it } from "vitest";
import { matchRate, formatMatchRatePct } from "@/modules/analytics/match-rate";

describe("matchRate (ANA-01)", () => {
  it("ANA-01: share of kept leads matched = distributed / (distributed + unmatched)", () => {
    expect(matchRate(412, 36)).toBeCloseTo(412 / 448, 10);
  });

  it("ANA-01: null when there are no kept leads (empty denominator)", () => {
    expect(matchRate(0, 0)).toBeNull();
  });

  it("ANA-01: 0 when every kept lead is unmatched", () => {
    expect(matchRate(0, 10)).toBe(0);
  });

  it("ANA-01: 1 when every kept lead is matched", () => {
    expect(matchRate(10, 0)).toBe(1);
  });
});

describe("formatMatchRatePct (ANA-01)", () => {
  it("ANA-01: rounds to a whole percent", () => {
    expect(formatMatchRatePct(matchRate(1, 2))).toBe("33%"); // 0.3333 → 33%
    expect(formatMatchRatePct(412 / 448)).toBe("92%");
  });

  it("ANA-01: null → em dash (no kept leads)", () => {
    expect(formatMatchRatePct(null)).toBe("—");
  });
});
