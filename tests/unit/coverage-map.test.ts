import { describe, expect, it } from "vitest";
import { buildStateCoverage } from "@/modules/coverage/map";

// MAP-01: the read-only coverage map colors each state by its state-rule partner,
// surfaces coverage gaps (leads from a state nobody owns), and drives a PRN-14
// legend (partner name + JV ref accompany every color). Pure shaping — same input
// ⇒ same output (PRN-01/15).

const P = [
  { id: "p1", name: "North Star JV", refId: "JV-001", color: "#3f9d7d" },
  { id: "p2", name: "Gulf Coast Buyers", refId: "JV-002", color: "#4f5bd5" },
  { id: "p3", name: "Idle Partner", refId: "JV-003", color: "#bf7d2a" },
];

describe("buildStateCoverage", () => {
  it("MAP-01: colors a state by its state-rule partner", () => {
    const model = buildStateCoverage([{ state: "NY", partnerId: "p1" }], P, []);
    const ny = model.states.find((s) => s.code === "NY")!;
    expect(ny.partnerId).toBe("p1");
    expect(ny.partnerName).toBe("North Star JV");
    expect(ny.refId).toBe("JV-001");
    expect(ny.color).toBe("#3f9d7d");
    expect(ny.gap).toBe(false);
  });

  it("WP-D: the house partner colors its states like any partner (maps show the admin's own territory)", () => {
    // The house is just an is_house partner in the pipeline; the map builder has no special case,
    // so a house-owned state fills with the house color and is never a gap (owner note #7).
    const house = { id: "house", name: "My Territory", refId: "HOUSE", color: "#3A3F4B" };
    const model = buildStateCoverage([{ state: "TX", partnerId: "house" }], [...P, house], [{ state: "TX", count: 5 }]);
    const tx = model.states.find((s) => s.code === "TX")!;
    expect(tx.color).toBe("#3A3F4B");
    expect(tx.refId).toBe("HOUSE");
    expect(tx.gap).toBe(false);
    expect(model.partners.some((p) => p.refId === "HOUSE")).toBe(true); // appears in the legend
  });

  it("MAP-01: a state with no rule is uncovered (null partner)", () => {
    const model = buildStateCoverage([{ state: "NY", partnerId: "p1" }], P, []);
    const tx = model.states.find((s) => s.code === "TX")!;
    expect(tx.partnerId).toBeNull();
    expect(tx.partnerName).toBeNull();
    expect(tx.color).toBeNull();
  });

  it("MAP-01: flags a coverage gap when an uncovered state has leads", () => {
    const model = buildStateCoverage([], P, [{ state: "TX", count: 12 }]);
    const tx = model.states.find((s) => s.code === "TX")!;
    expect(tx.gap).toBe(true);
    expect(tx.leadCount).toBe(12);
    expect(model.gapCount).toBe(1);
  });

  it("MAP-01: a covered state with leads is never a gap", () => {
    const model = buildStateCoverage([{ state: "TX", partnerId: "p2" }], P, [{ state: "TX", count: 12 }]);
    const tx = model.states.find((s) => s.code === "TX")!;
    expect(tx.gap).toBe(false);
    expect(model.gapCount).toBe(0);
  });

  it("MAP-01: an uncovered state with zero leads is not a gap", () => {
    const model = buildStateCoverage([], P, []);
    expect(model.states.every((s) => s.gap === false)).toBe(true);
    expect(model.gapCount).toBe(0);
  });

  it("MAP-01: legend lists only partners owning >= 1 state, with state counts", () => {
    const model = buildStateCoverage(
      [
        { state: "NY", partnerId: "p1" },
        { state: "NJ", partnerId: "p1" },
        { state: "TX", partnerId: "p2" },
      ],
      P,
      [],
    );
    // p3 owns nothing → excluded from the legend.
    expect(model.partners.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(model.partners.find((p) => p.id === "p1")!.stateCount).toBe(2);
    expect(model.partners.find((p) => p.id === "p2")!.stateCount).toBe(1);
  });

  it("MAP-01: covers all 51 hex states (50 + DC) and counts covered states", () => {
    const model = buildStateCoverage([{ state: "NY", partnerId: "p1" }], P, []);
    expect(model.states).toHaveLength(51);
    expect(model.coveredCount).toBe(1);
  });

  it("MAP-01: ignores lead counts for unknown state codes (no crash)", () => {
    const model = buildStateCoverage([], P, [{ state: "ZZ", count: 5 }]);
    expect(model.states.find((s) => s.code === "ZZ")).toBeUndefined();
    expect(model.gapCount).toBe(0);
  });

  it("PRN-01: same input produces identical output", () => {
    const args = [[{ state: "CA", partnerId: "p2" }], P, [{ state: "CA", count: 3 }]] as const;
    expect(buildStateCoverage(...args)).toEqual(buildStateCoverage(...args));
  });
});
