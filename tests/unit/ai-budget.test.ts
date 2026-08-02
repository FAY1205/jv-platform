import { describe, it, expect } from "vitest";
import { rateDecision, monthStartUtc, RATE_LIMIT_PER_MINUTE } from "@/modules/ai/budget";

// The monthly spend cap was removed (ADR-0036 follow-up) — tenants cap spend in their
// own provider dashboard. Only the rate guardrail + the usage-window helper remain.
describe("ai rate decision + month window (AIA-06/SET-11)", () => {
  it("rate: 15 in the last minute allows the 15th, blocks the 16th", () => {
    expect(RATE_LIMIT_PER_MINUTE).toBe(15);
    expect(rateDecision({ questionsLastMinute: 14 }).allowed).toBe(true);
    expect(rateDecision({ questionsLastMinute: 15 }).allowed).toBe(false);
  });
  it("monthStartUtc: usage window resets on the 1st, UTC", () => {
    expect(monthStartUtc(new Date("2026-07-13T22:15:00Z")).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});
