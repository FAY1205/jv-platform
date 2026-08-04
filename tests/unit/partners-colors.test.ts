import { describe, expect, it } from "vitest";
import { pickPartnerColor } from "@/modules/partners/colors";
import { PARTNER_SWATCHES } from "@/lib/tokens/tokens";

// PRN-06/14: a partner's color is assigned once from the locked, AA-contrast swatch
// pool, and a new partner gets a color not already in use.
describe("pickPartnerColor", () => {
  it("PARTNERS-COLOR-01: assigns the first swatch when none are used", () => {
    expect(pickPartnerColor([])).toBe(PARTNER_SWATCHES[0]);
  });

  it("PARTNERS-COLOR-02: skips colors already in use (case-insensitive)", () => {
    const used = [PARTNER_SWATCHES[0].toUpperCase(), PARTNER_SWATCHES[1]];
    expect(pickPartnerColor(used)).toBe(PARTNER_SWATCHES[2]);
  });

  it("PARTNERS-COLOR-03: never hard-fails when the pool is exhausted", () => {
    const all = PARTNER_SWATCHES.map((c) => c);
    const picked = pickPartnerColor(all);
    expect(PARTNER_SWATCHES).toContain(picked);
  });
});
