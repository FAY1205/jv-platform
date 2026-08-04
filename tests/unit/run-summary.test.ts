import { describe, expect, it } from "vitest";
import { computeRunSummary, type RunSummaryLead } from "@/modules/analytics/run-summary";

function mk(over: Partial<RunSummaryLead>): RunSummaryLead {
  return { mlsStatus: "kept", matchMethod: "state_fallback", partnerId: "p1", ...over };
}

// A representative processed run: delivered-to-partners, removed (MLS), unmatched.
// ADR-0038: no previously-matched concept — every row is an ordinary lead.
const LEADS: RunSummaryLead[] = [
  mk({ partnerId: "p1" }),
  mk({ partnerId: "p1" }),
  mk({ partnerId: "p2" }),
  mk({ mlsStatus: "removed", partnerId: "p2" }), // MLS-listed → not delivered
  mk({ matchMethod: "none", partnerId: null }), // unmatched, kept
  mk({ mlsStatus: "removed", matchMethod: "none", partnerId: null }), // unmatched + removed
];

describe("EXP-04 / PRN-15: computeRunSummary (single source of run stats)", () => {
  const s = computeRunSummary(LEADS);

  it("totals reflect the whole run", () => {
    expect(s.total).toBe(6);
    expect(s.kept).toBe(4);
    expect(s.removed).toBe(2);
  });

  it("counts unmatched among kept leads only — removed leads are out of the funnel", () => {
    // The removed+unmatched lead is REMOVED, not a routing gap: total partitions
    // cleanly into delivered + unmatched + removed, matching the on-screen tables.
    expect(s.unmatched).toBe(1);
  });

  it("per-partner counts only delivered (kept + assigned) leads, sorted deterministically", () => {
    expect(s.perPartner).toEqual([
      { partnerId: "p1", count: 2 },
      { partnerId: "p2", count: 1 }, // p2's removed lead is not delivered
    ]);
  });

  it("PRN-01: deterministic — same input ⇒ identical summary", () => {
    expect(computeRunSummary(LEADS)).toEqual(computeRunSummary(LEADS));
  });

  it("handles an empty run", () => {
    expect(computeRunSummary([])).toEqual({
      total: 0,
      kept: 0,
      removed: 0,
      unmatched: 0,
      perPartner: [],
    });
  });
});
