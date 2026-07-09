import { describe, expect, it } from "vitest";
import { campaignQuality, type SourceLead } from "@/modules/analytics/source-quality";

// ANA-02: which lead source wastes money. A campaign's removal rate (leads
// discarded as MLS-listed) is the hidden leak. PURE (PRN-01), single home of
// the number (PRN-15).

const mk = (campaign: string | null, mlsStatus: "kept" | "removed"): SourceLead => ({ campaign, mlsStatus });

describe("campaignQuality", () => {
  it("aggregates per campaign with removal rate, ordered by volume desc", () => {
    const rows = campaignQuality([
      mk("Zillow", "kept"),
      mk("Zillow", "kept"),
      mk("Zillow", "removed"),
      mk("Facebook", "removed"),
      mk("Facebook", "removed"),
    ]);
    expect(rows).toEqual([
      { campaign: "Zillow", total: 3, kept: 2, removed: 1, removalRate: 1 / 3 },
      { campaign: "Facebook", total: 2, kept: 0, removed: 2, removalRate: 1 },
    ]);
  });

  it("breaks volume ties by campaign name", () => {
    const rows = campaignQuality([mk("B", "kept"), mk("A", "kept")]);
    expect(rows.map((r) => r.campaign)).toEqual(["A", "B"]);
  });

  it("buckets blank/null campaigns under a stable label", () => {
    const rows = campaignQuality([mk(null, "kept"), mk("", "removed")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].campaign).toBe("Unattributed");
    expect(rows[0].total).toBe(2);
  });

  it("returns empty for no leads", () => {
    expect(campaignQuality([])).toEqual([]);
  });

  it("PRN-01: deterministic", () => {
    const rows = [mk("X", "kept"), mk("X", "removed")];
    expect(campaignQuality(rows)).toEqual(campaignQuality(rows));
  });
});
