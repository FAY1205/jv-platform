import { describe, it, expect } from "vitest";
import { matchMethodEnum } from "@/db/schema";
import { MATCH_METHOD_LABEL, matchMethodLabel, routedByLabel } from "@/lib/match-method";

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

describe("routedByLabel (F-57: routing method + the key it matched on)", () => {
  it("appends the matched ZIP to a zip match", () => {
    expect(routedByLabel("zip", "90210")).toEqual({ label: "ZIP match · 90210", badge: "zip" });
  });

  it("appends the matched state to a state fallback", () => {
    expect(routedByLabel("state_fallback", "CA")).toEqual({ label: "State fallback · CA", badge: "state" });
  });

  it("falls back to the bare label when no key was recorded", () => {
    expect(routedByLabel("zip", null)).toEqual({ label: "ZIP match", badge: "zip" });
    expect(routedByLabel("none", null)).toEqual({ label: "No match", badge: "neutral" });
  });

  it("treats a blank key as no key", () => {
    expect(routedByLabel("zip", "  ")).toEqual({ label: "ZIP match", badge: "zip" });
  });
});

// routingExplanation was removed with its only consumer (owner testing note #3,
// 2026-07-14) — see src/lib/match-method.ts.
