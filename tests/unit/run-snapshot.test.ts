import { describe, expect, it } from "vitest";
import { buildRulesSnapshot, type RulesSnapshotInput } from "@/modules/run/snapshot";

const BASE: RulesSnapshotInput = {
  sourceProfile: { id: "investorfuse", version: 1 },
  mlsPatterns: [
    { id: "dq_yes", type: "disqualify", regex: "is it listed.*yes" },
    { id: "ko_no", type: "keep_override", regex: "is it listed.*no" },
  ],
  stateRules: [
    { state: "NJ", partnerId: "p-josh" },
    { state: "SC", partnerId: "p-randy" },
  ],
  zipCoverage: [{ zip5: "77021", partnerId: "p-joe" }],
};

describe("DM-08: rules snapshot pins the rule set for determinism", () => {
  it("is deterministic — same rule set ⇒ same hash", () => {
    expect(buildRulesSnapshot(BASE).hash).toBe(buildRulesSnapshot(BASE).hash);
  });

  it("is order-independent — reordering the same rules ⇒ same hash", () => {
    const reordered: RulesSnapshotInput = {
      ...BASE,
      mlsPatterns: [BASE.mlsPatterns[1], BASE.mlsPatterns[0]],
      stateRules: [BASE.stateRules[1], BASE.stateRules[0]],
    };
    expect(buildRulesSnapshot(reordered).hash).toBe(buildRulesSnapshot(BASE).hash);
  });

  it("changes the hash when a rule actually changes", () => {
    const changed: RulesSnapshotInput = {
      ...BASE,
      stateRules: [{ state: "NJ", partnerId: "p-different" }, BASE.stateRules[1]],
    };
    expect(buildRulesSnapshot(changed).hash).not.toBe(buildRulesSnapshot(BASE).hash);
  });

  it("changes the hash when the source profile version bumps (drift, ING-08)", () => {
    const v2: RulesSnapshotInput = { ...BASE, sourceProfile: { id: "investorfuse", version: 2 } };
    expect(buildRulesSnapshot(v2).hash).not.toBe(buildRulesSnapshot(BASE).hash);
  });

  it("captures the rule set in the stored snapshot", () => {
    const { snapshot } = buildRulesSnapshot(BASE);
    expect(snapshot.sourceProfile).toEqual({ id: "investorfuse", version: 1 });
    expect(snapshot.mlsPatterns).toHaveLength(2);
    expect(snapshot.zipCoverage).toEqual([{ zip5: "77021", partnerId: "p-joe" }]);
  });

  it("DM-08: records the scoring scheme version, and a scheme change re-hashes", () => {
    const { snapshot } = buildRulesSnapshot(BASE);
    expect(snapshot.scoringVersion).toBeTruthy(); // defaults to the code-pinned SCORING_VERSION
    const rescored: RulesSnapshotInput = { ...BASE, scoringVersion: "residi-v2-hypothetical" };
    expect(buildRulesSnapshot(rescored).hash).not.toBe(buildRulesSnapshot(BASE).hash);
  });
});
