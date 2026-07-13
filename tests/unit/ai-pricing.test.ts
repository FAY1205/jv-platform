import { describe, it, expect } from "vitest";
import { AI_MODEL, priceFor, costMicroUsd } from "@/modules/ai/pricing";

describe("ai pricing (AIA-06, ADR-0027)", () => {
  it("AIA-06: prices the default model (Flash-Lite $0.25/$1.50 per MTok)", () => {
    expect(priceFor(AI_MODEL)).toEqual({ inputMicroUsdPerMTok: 250_000, outputMicroUsdPerMTok: 1_500_000 });
  });
  it("AIA-06: computes integer micro-USD cost (6k in + 500 out ≈ 2250 µ$)", () => {
    // 6000/1e6*250000 = 1500; 500/1e6*1500000 = 750 → 2250
    expect(costMicroUsd(AI_MODEL, 6000, 500)).toBe(2250);
  });
  it("AIA-06: rounds up so cost is never understated", () => {
    expect(costMicroUsd(AI_MODEL, 1, 0)).toBe(1); // 0.25 µ$ → ceil 1
  });
  it("ADR-0027: unknown model has NO price — caller must refuse, never guess", () => {
    expect(priceFor("openai/gpt-5.4")).toBeNull();
    expect(costMicroUsd("openai/gpt-5.4", 1000, 1000)).toBeNull();
  });
  it("ADR-0027: the pinned fallback (Haiku 4.5) is priced", () => {
    expect(priceFor("anthropic/claude-haiku-4.5")).toEqual({ inputMicroUsdPerMTok: 1_000_000, outputMicroUsdPerMTok: 5_000_000 });
  });
});
