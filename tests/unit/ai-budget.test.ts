import { describe, it, expect } from "vitest";
import { budgetDecision, rateDecision, monthStartUtc, DEFAULT_MONTHLY_CAP_USD, RATE_LIMIT_PER_MINUTE } from "@/modules/ai/budget";

describe("ai budget/rate decisions (AIA-06/SET-11)", () => {
  it("SET-11: default cap is $10", () => expect(DEFAULT_MONTHLY_CAP_USD).toBe(10));
  it("AIA-06: under the cap allows", () => {
    expect(budgetDecision({ spentMicroUsd: 9_999_999, capUsd: 10 }).allowed).toBe(true);
  });
  it("AIA-06: at the cap hard-stops (owner decision: hard stop)", () => {
    expect(budgetDecision({ spentMicroUsd: 10_000_000, capUsd: 10 }).allowed).toBe(false);
  });
  it("AIA-06: a zero/negative cap disables entirely", () => {
    expect(budgetDecision({ spentMicroUsd: 0, capUsd: 0 }).allowed).toBe(false);
  });
  it("rate: 15 in the last minute allows the 15th, blocks the 16th", () => {
    expect(RATE_LIMIT_PER_MINUTE).toBe(15);
    expect(rateDecision({ questionsLastMinute: 14 }).allowed).toBe(true);
    expect(rateDecision({ questionsLastMinute: 15 }).allowed).toBe(false);
  });
  it("monthStartUtc: cap resets on the 1st, UTC", () => {
    expect(monthStartUtc(new Date("2026-07-13T22:15:00Z")).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});
