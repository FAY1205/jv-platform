import { describe, expect, it } from "vitest";
import { relativeLuminance, contrastRatio } from "@/lib/contrast";

// WP-H / CON-01: the ONE shared WCAG contrast primitive. This suite is the reason the
// project can safely dedupe every hand-rolled luminance copy into it: it pins the math to
// EXTERNAL reference values (WebAIM / the WCAG 2.x definition), not to numbers re-derived
// with the same formula — so no consumer test grades a function against itself.
describe("CON-01: WCAG relativeLuminance / contrastRatio (reference-pinned)", () => {
  it("CON-01: relativeLuminance of pure white is 1 and pure black is 0 (WCAG definition)", () => {
    expect(relativeLuminance("#FFFFFF")).toBe(1);
    expect(relativeLuminance("#000000")).toBe(0);
  });

  it("CON-01: relativeLuminance of mid-grey #808080 ≈ 0.2159 (W3C worked example)", () => {
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 3);
  });

  it("CON-01: contrastRatio(black, white) is the WCAG maximum 21:1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });

  it("CON-01: WebAIM AA-threshold greys on white — #767676 passes 4.5:1, #777777 fails", () => {
    // WebAIM documents #767676 as the darkest grey that still passes AA (4.54:1) on white,
    // and #777777 as the first that fails (4.48:1). An external boundary the formula must hit.
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeLessThan(4.5);
  });

  it("CON-01: contrastRatio is symmetric in its arguments", () => {
    expect(contrastRatio("#B23A2E", "#FFFFFF")).toBeCloseTo(contrastRatio("#FFFFFF", "#B23A2E"), 10);
  });

  it("CON-01: accepts 3-digit shorthand identically to 6-digit", () => {
    expect(relativeLuminance("#fff")).toBe(relativeLuminance("#ffffff"));
    expect(relativeLuminance("#000")).toBe(relativeLuminance("#000000"));
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
  });

  it("CON-01: never throws — unparseable input has luminance 0", () => {
    expect(relativeLuminance("not-a-color")).toBe(0);
    expect(relativeLuminance("")).toBe(0);
    expect(() => contrastRatio("garbage", "#FFFFFF")).not.toThrow();
  });
});
