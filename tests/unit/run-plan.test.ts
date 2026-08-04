import { describe, expect, it } from "vitest";
import { planRun, type RunRules } from "@/modules/run/plan";
import { GENERIC_PROFILE } from "@/modules/sources";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import { buildCoverage } from "@/modules/pipeline/assign";
import type { HistoryEntry } from "@/modules/pipeline/dedupe";

const RULES: RunRules = {
  mlsPatterns: DEFAULT_MLS_PATTERNS,
  coverage: buildCoverage([], [
    { state: "NJ", partnerId: "p-josh" },
    { state: "SC", partnerId: "p-randy" },
  ]),
};

// GENERIC_PROFILE headers.
function row(over: Record<string, string>): Record<string, string> {
  return {
    Campaign: "Lead Zolo 1.0",
    "Date Created": "2026-07-06",
    Notes: "",
    Address: "1 A St",
    City: "Town",
    State: "NJ",
    Zip: "08034",
    "Seller First Name": "A",
    "Seller Last Name": "B",
    Phone: "(856) 555-0100",
    Email: "a@example.test",
    "Reason For Selling": "x",
    Motivation: "y",
    "Time to Sell": "z",
    ...over,
  };
}

const ROWS = [
  row({ Address: "1 A St", State: "NJ", Zip: "8034", Notes: "off market" }),
  row({ Address: "2 B St", State: "SC", Zip: "29601", Notes: "Is it Listed? : yes" }),
  row({ Address: "3 C St", State: "CA", Zip: "90001", Campaign: "Other Source" }),
];

describe("WP-017: planRun composes the pure pipeline into a persisted-run plan", () => {
  const plan = planRun(ROWS, GENERIC_PROFILE, RULES, new Map());

  it("normalizes, MLS-filters and assigns each lead; campaign passes through as-imported", () => {
    expect(plan.leads[0]).toMatchObject({
      zip5: "08034",
      stateCode: "NJ",
      mlsStatus: "kept",
      campaign: "Lead Zolo 1.0",
      partnerId: "p-josh",
      matchMethod: "state_fallback",
    });
    // Removed lead is still assigned (routing is independent of the MLS verdict).
    expect(plan.leads[1]).toMatchObject({ mlsStatus: "removed", partnerId: "p-randy" });
    // Out-of-territory → unmatched; campaign is the as-imported value (ADR-0018).
    expect(plan.leads[2]).toMatchObject({ matchMethod: "none", partnerId: null, campaign: "Other Source" });
  });

  it("preserves the full source row in rawJson (DM-02) and reports row errors (ING-04)", () => {
    expect(plan.leads[0].rawJson).toMatchObject({ Address: "1 A St" });
    expect(plan.leads[0].rowErrors).toEqual([]);
  });

  it("new leads carry firstMatchedAt=null for the caller to stamp (PRN-01 purity)", () => {
    expect(plan.leads[0].firstMatchedAt).toBeNull();
    expect(plan.leads[0].previouslyMatched).toBe(false);
  });

  it("summary comes from the single analytics source (PRN-15)", () => {
    expect(plan.summary).toMatchObject({ total: 3, kept: 2, removed: 1, unmatched: 1 });
    expect(plan.summary.perPartner).toEqual([{ partnerId: "p-josh", count: 1 }]);
  });

  it("DED/PRN-05: a lead already in history is flagged and reverts to the original partner", () => {
    const history = new Map<string, HistoryEntry>([
      [
        plan.leads[0].dedupeKey,
        { partnerId: "p-original", matchMethod: "zip", firstMatchedAt: "2026-06-01T00:00:00Z", phoneNorm: "8565550100" },
      ],
    ]);
    const p2 = planRun(ROWS, GENERIC_PROFILE, RULES, history);
    expect(p2.leads[0]).toMatchObject({
      previouslyMatched: true,
      partnerId: "p-original",
      firstMatchedAt: "2026-06-01T00:00:00Z",
    });
  });

  it("PRN-01: deterministic for identical inputs", () => {
    expect(planRun(ROWS, GENERIC_PROFILE, RULES, new Map())).toEqual(
      planRun(ROWS, GENERIC_PROFILE, RULES, new Map()),
    );
  });
});
