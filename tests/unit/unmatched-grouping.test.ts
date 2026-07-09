import { describe, expect, it } from "vitest";
import { groupUnmatchedByState, type UnmatchedLead } from "@/modules/leads/unmatched";

// ASN-03: the unmatched inbox groups gap leads by state (biggest gap first) so
// "recruit/assign a partner here" is an obvious decision. PURE (PRN-01).

const mk = (over: Partial<UnmatchedLead>): UnmatchedLead => ({
  refId: "LD-1",
  seller: "A Seller",
  address: "1 St",
  city: "Town",
  state: "TX",
  zip: "75001",
  campaign: null,
  receivedAt: "2026-07-01T00:00:00Z",
  ...over,
});

describe("groupUnmatchedByState", () => {
  it("groups by state and orders by count desc, then state asc", () => {
    const groups = groupUnmatchedByState([
      mk({ refId: "LD-1", state: "TX" }),
      mk({ refId: "LD-2", state: "TX" }),
      mk({ refId: "LD-3", state: "CA" }),
      mk({ refId: "LD-4", state: "NV" }),
    ]);
    expect(groups.map((g) => [g.state, g.count])).toEqual([
      ["TX", 2],
      ["CA", 1],
      ["NV", 1],
    ]);
    expect(groups[0].leads.map((l) => l.refId)).toEqual(["LD-1", "LD-2"]);
  });

  it("collects distinct ZIPs per state (sorted) for the 'recruit here' hint", () => {
    const groups = groupUnmatchedByState([
      mk({ state: "TX", zip: "75002" }),
      mk({ state: "TX", zip: "75001" }),
      mk({ state: "TX", zip: "75001" }),
    ]);
    expect(groups[0].zips).toEqual(["75001", "75002"]);
  });

  it("buckets missing/blank state under a stable '—' key, sorted last", () => {
    const groups = groupUnmatchedByState([
      mk({ refId: "LD-1", state: null }),
      mk({ refId: "LD-2", state: "" }),
      mk({ refId: "LD-3", state: "CA" }),
    ]);
    expect(groups.map((g) => g.state)).toEqual(["CA", "—"]); // "—" sinks last despite count
    expect(groups.find((g) => g.state === "—")!.count).toBe(2);
  });

  it("returns empty for no leads", () => {
    expect(groupUnmatchedByState([])).toEqual([]);
  });

  it("PRN-01: deterministic", () => {
    const leads = [mk({ refId: "LD-1", state: "TX" }), mk({ refId: "LD-2", state: "CA" })];
    expect(groupUnmatchedByState(leads)).toEqual(groupUnmatchedByState(leads));
  });
});
