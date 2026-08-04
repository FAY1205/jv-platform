import { describe, expect, it } from "vitest";
import { planRun, type RunRules } from "@/modules/run/plan";
import { GENERIC_PROFILE } from "@/modules/sources";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import { buildCoverage } from "@/modules/pipeline/assign";

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
  const plan = planRun(ROWS, GENERIC_PROFILE, RULES);

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

  it("every lead carries firstMatchedAt=null for the caller to stamp (PRN-01 purity)", () => {
    expect(plan.leads[0].firstMatchedAt).toBeNull();
  });

  it("summary comes from the single analytics source (PRN-15)", () => {
    expect(plan.summary).toMatchObject({ total: 3, kept: 2, removed: 1, unmatched: 1 });
    expect(plan.summary.perPartner).toEqual([{ partnerId: "p-josh", count: 1 }]);
  });

  it("ADR-0038: duplicate rows are NOT collapsed — every row becomes its own lead", () => {
    // Two rows for the same house (same address + ZIP) in one file: both survive,
    // both are routed by the current coverage. Dedup was retired (event-model leads);
    // the dedupe key is still computed and stored for later grouping/reporting.
    const dup = planRun([ROWS[0], ROWS[0]], GENERIC_PROFILE, RULES);
    expect(dup.leads).toHaveLength(2);
    expect(dup.leads[0].dedupeKey).toBe(dup.leads[1].dedupeKey);
    expect(dup.leads[1]).toMatchObject({ partnerId: "p-josh", matchMethod: "state_fallback" });
    expect(dup.summary.total).toBe(2);
    expect(dup.summary.perPartner).toEqual([{ partnerId: "p-josh", count: 2 }]);
  });

  it("PRN-01: deterministic for identical inputs", () => {
    expect(planRun(ROWS, GENERIC_PROFILE, RULES)).toEqual(planRun(ROWS, GENERIC_PROFILE, RULES));
  });
});
