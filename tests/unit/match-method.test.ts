import { describe, it, expect } from "vitest";
import { matchMethodEnum } from "@/db/schema";
import { MATCH_METHOD_LABEL, matchMethodLabel, routingExplanation } from "@/lib/match-method";

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

describe("routingExplanation (F-57)", () => {
  const base = { partnerName: "Summit Partners", manual: false, matchMethod: "zip", zip: "98075", state: "WA" };
  it("F-57: ZIP match names the ZIP", () => {
    expect(routingExplanation(base)).toBe("Routed to Summit Partners because ZIP 98075 falls inside their territory.");
  });
  it("F-57: state fallback names the state", () => {
    expect(routingExplanation({ ...base, matchMethod: "state_fallback" })).toBe("Routed to Summit Partners by state coverage — WA falls back to them.");
  });
  it("F-57: manual assignment overrides the match method", () => {
    expect(routingExplanation({ ...base, manual: true })).toBe("Manually assigned to Summit Partners.");
  });
  it("F-57: unknown method degrades to a plain assignment sentence", () => {
    expect(routingExplanation({ ...base, matchMethod: "none" })).toBe("Assigned to Summit Partners.");
  });
});
