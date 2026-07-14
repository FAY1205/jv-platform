import { describe, it, expect } from "vitest";
import { matchMethodEnum } from "@/db/schema";
import { MATCH_METHOD_LABEL, matchMethodLabel } from "@/lib/match-method";

describe("MATCH_METHOD_LABEL (F-57)", () => {
  it("F-57: has an exhaustive label for every match_method enum value", () => {
    for (const v of matchMethodEnum.enumValues) {
      expect(MATCH_METHOD_LABEL[v as keyof typeof MATCH_METHOD_LABEL]).toBeDefined();
    }
    expect(Object.keys(MATCH_METHOD_LABEL).sort()).toEqual([...matchMethodEnum.enumValues].sort());
  });

  it("F-57: matchMethodLabel maps known values (label + badge) and folds unknowns", () => {
    expect(matchMethodLabel("zip")).toEqual({ label: "ZIP match", badge: "zip" });
    expect(matchMethodLabel("state_fallback")).toEqual({ label: "State fallback", badge: "state" });
    expect(matchMethodLabel("bogus")).toEqual({ label: "Unknown", badge: "neutral" });
  });
});

// routingExplanation was removed with its only consumer (owner testing note #3,
// 2026-07-14) — see src/lib/match-method.ts.
