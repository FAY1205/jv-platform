import { describe, expect, it } from "vitest";
import { assign, buildCoverage, type Coverage } from "@/modules/pipeline/assign";

// Partners are referenced ONLY as opaque ids — the engine never knows a partner name,
// which is exactly why no special-case partner code is possible (ASN-02).
const RANDY = "p-randy";
const FORREST = "p-forrest";
const JOSH = "p-josh";
const COASTAL = "p-coastal";

const coverage: Coverage = buildCoverage(
  [
    { zip5: "23451", partnerId: COASTAL }, // a Virginia Beach ZIP → NOT the VA fallback
    { zip5: "29601", partnerId: RANDY },
  ],
  [
    { state: "SC", partnerId: RANDY },
    { state: "VA", partnerId: FORREST },
    { state: "NJ", partnerId: JOSH },
    { state: "CT", partnerId: JOSH },
  ],
);

describe("ASN-01: assignment precedence", () => {
  it("ASN-01: exact zip match beats state fallback", () => {
    // 23451 sits in VA (fallback FORREST) but the ZIP itself maps to COASTAL → ZIP wins.
    expect(assign("23451", "VA", coverage)).toEqual({
      partnerId: COASTAL,
      matchMethod: "zip",
      matchedOn: "23451",
    });
  });

  it("ASN-01: state fallback when the zip is not in coverage", () => {
    expect(assign("07030", "NJ", coverage)).toEqual({
      partnerId: JOSH,
      matchMethod: "state_fallback",
      matchedOn: "NJ",
    });
  });

  it("ASN-01: unmatched when neither zip nor state is covered", () => {
    expect(assign("90210", "CA", coverage)).toEqual({
      partnerId: null,
      matchMethod: "none",
      matchedOn: null,
    });
  });

  it("ASN-01: an empty zip falls through to the state fallback", () => {
    expect(assign("", "SC", coverage)).toMatchObject({
      partnerId: RANDY,
      matchMethod: "state_fallback",
    });
  });

  it("ASN-01: a leading-zero zip5 matches coverage keyed on the padded form (NRM-01)", () => {
    const cov = buildCoverage([{ zip5: "06511", partnerId: JOSH }], []);
    expect(assign("06511", "CT", cov)).toMatchObject({ partnerId: JOSH, matchMethod: "zip" });
  });
});

describe("ASN-02: regional exceptions emerge from ZIP precedence, not code", () => {
  it("ASN-02: a Virginia Beach ZIP routes to its own partner though VA falls back elsewhere", () => {
    // Same state, two ZIPs, two partners — purely data-driven, no special-case branch.
    expect(assign("23451", "VA", coverage).partnerId).toBe(COASTAL); // VB ZIP
    expect(assign("24012", "VA", coverage).partnerId).toBe(FORREST); // other VA → state fallback
  });
});

describe("ASN-03: unmatched exposes zip/state for the coverage-gap view", () => {
  it("returns matchMethod none and a null partner so the row can surface its zip+state", () => {
    const r = assign("60614", "IL", coverage);
    expect(r.matchMethod).toBe("none");
    expect(r.partnerId).toBeNull();
  });
});

describe("PRN-01: assignment determinism", () => {
  it("same inputs ⇒ identical result", () => {
    expect(assign("23451", "VA", coverage)).toEqual(assign("23451", "VA", coverage));
  });
});

describe("buildCoverage", () => {
  it("indexes zip and state rows into lookup maps", () => {
    const cov = buildCoverage([{ zip5: "12345", partnerId: "x" }], [{ state: "NY", partnerId: "y" }]);
    expect(cov.byZip.get("12345")).toBe("x");
    expect(cov.byState.get("NY")).toBe("y");
  });
});
