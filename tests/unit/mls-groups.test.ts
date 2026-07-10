import { describe, it, expect } from "vitest";
import { groupMlsPatterns } from "@/lib/mls-groups";

// WS-6 Rules: the MLS phrases card groups patterns by effect. Keep-override phrases
// BEAT disqualifiers (MLS-02 — the engine checks overrides first), so their group is
// presented first. Pure partition/order logic; page owns the copy.

type P = { patternKey: string; type: "keep_override" | "disqualify" };
const dq = (k: string): P => ({ patternKey: k, type: "disqualify" });
const ko = (k: string): P => ({ patternKey: k, type: "keep_override" });

describe("groupMlsPatterns (WS-6 Rules)", () => {
  it("MLS-02/CVG-02: keep-override group is ordered before disqualify (overrides win)", () => {
    const groups = groupMlsPatterns([dq("dq_a"), ko("ko_a"), dq("dq_b"), ko("ko_b")]);
    expect(groups.map((g) => g.effect)).toEqual(["keep_override", "disqualify"]);
  });

  it("partitions patterns by type, preserving input order within a group", () => {
    const groups = groupMlsPatterns([ko("ko_a"), dq("dq_a"), ko("ko_b")]);
    expect(groups[0]).toEqual({ effect: "keep_override", patterns: [ko("ko_a"), ko("ko_b")] });
    expect(groups[1]).toEqual({ effect: "disqualify", patterns: [dq("dq_a")] });
  });

  it("omits an empty group when only one effect is present", () => {
    const groups = groupMlsPatterns([dq("dq_a"), dq("dq_b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].effect).toBe("disqualify");
  });

  it("returns [] for no patterns", () => {
    expect(groupMlsPatterns([])).toEqual([]);
  });
});
