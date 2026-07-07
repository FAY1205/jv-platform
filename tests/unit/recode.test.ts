import { describe, expect, it } from "vitest";
import { recode, type CampaignRecode } from "@/modules/pipeline/recode";

// Seed recodes (EXP-01): trailing-* is a prefix match; no * is exact. First rule wins.
const RULES: CampaignRecode[] = [
  { matchPattern: "Lead Zolo*", code: "Z" },
  { matchPattern: "Real Estate Bees", code: "B" },
];

describe("EXP-01: campaign recode", () => {
  it("EXP-01: prefix-matches 'Lead Zolo 1.0' → Z", () => {
    expect(recode("Lead Zolo 1.0", RULES)).toBe("Z");
  });

  it("EXP-01: exact-matches 'Real Estate Bees' → B", () => {
    expect(recode("Real Estate Bees", RULES)).toBe("B");
  });

  it("EXP-01: is case-insensitive", () => {
    expect(recode("lead zolo 2.0", RULES)).toBe("Z");
  });

  it("EXP-01: an unmatched campaign passes through unchanged", () => {
    expect(recode("Facebook Ads", RULES)).toBe("Facebook Ads");
  });

  it("EXP-01: first matching rule wins", () => {
    const rules: CampaignRecode[] = [
      { matchPattern: "Lead*", code: "L" },
      { matchPattern: "Lead Zolo*", code: "Z" },
    ];
    expect(recode("Lead Zolo 1.0", rules)).toBe("L");
  });

  it("handles an empty/blank campaign", () => {
    expect(recode("", RULES)).toBe("");
    expect(recode("   ", RULES)).toBe("");
  });
});
