import { describe, it, expect } from "vitest";
import { contrastText, contrastHalo, contrastRatio } from "@/lib/contrast";
import { PARTNER_SWATCHES } from "@/lib/tokens/tokens";

const PARTNER_FILL_OPACITY = 0.9; // mirror of the shared constant (src/components/map/mapStyle)

// Per-channel sRGB composite of a fill at `opacity` over a solid surface — what a
// renderer actually shows for fill-opacity. Used to prove the label pick is stable.
function composite(fillHex: string, opacity: number, overHex: string): string {
  const rgb = (h: string) => {
    const s = h.replace(/^#/, "");
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  };
  const [fr, fg, fb] = rgb(fillHex);
  const [br, bg, bb] = rgb(overHex);
  const mix = (f: number, b: number) => Math.round(f * opacity + b * (1 - opacity));
  const h2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h2(mix(fr, br))}${h2(mix(fg, bg))}${h2(mix(fb, bb))}`;
}

// WP-H / CON-01: the luminance/ratio math is the shared contrastRatio primitive
// (src/lib/contrast.ts), reference-pinned by wcag.test.ts. `composite` above stays local —
// it is sRGB alpha-compositing, not luminance math.

// WS-8 / F-19: pick a readable label color (black/white) for text drawn ON a partner fill,
// by WCAG relative luminance — instead of always-white (which fails on light partner tints).
describe("contrastText", () => {
  it("F-19: returns dark text on a light background", () => {
    expect(contrastText("#ffffff")).toBe("#111111");
    expect(contrastText("#f4c95d")).toBe("#111111"); // light gold partner tint
  });

  it("F-19: returns white text on a dark background", () => {
    expect(contrastText("#000000")).toBe("#ffffff");
    expect(contrastText("#2c785d")).toBe("#ffffff"); // dark green
  });

  it("accepts 3-digit shorthand hex", () => {
    expect(contrastText("#fff")).toBe("#111111");
    expect(contrastText("#000")).toBe("#ffffff");
  });

  it("falls back to dark text for an unparseable value (never throws)", () => {
    expect(contrastText("not-a-color")).toBe("#111111");
    expect(contrastText("")).toBe("#111111");
  });
});

// On-fill 2-letter map labels sit on saturated partner tints. contrastText picks the
// higher-contrast of black/white; the project's fill-text bar is SC 1.4.3 = 4.5:1, but
// these small labels reach only ~3.74:1 on the most saturated swatches at ~0.9 opacity.
// That gap is an ACCEPTED, documented exception (ADR-0024): the labels carry a
// contrasting halo (contrastHalo) and every label's data is redundantly identified at
// solid AA via the hover tooltip and the keyboard companion list. These tests prove the
// pick is optimal and pin a regression floor so on-fill contrast can't silently degrade.
describe("on-fill map label contrast (F-19 / SC 1.4.3 · ADR-0024)", () => {
  it("F-19: picks a black-or-white on-fill label for every partner swatch", () => {
    for (const hex of PARTNER_SWATCHES) {
      expect(["#111111", "#ffffff"]).toContain(contrastText(hex));
    }
  });

  it("F-19: contrastText matches the black-vs-white luminance-optimal pick for every swatch", () => {
    // The F-19 guarantee: pick the tone the standard black-vs-white contrast heuristic
    // prefers (returned as near-black #111111 / white #ffffff). Verified against pure
    // black/white — the crossover contrastText's 0.179 luminance threshold encodes.
    for (const hex of PARTNER_SWATCHES) {
      const optimal = contrastRatio("#000000", hex) >= contrastRatio("#ffffff", hex) ? "#111111" : "#ffffff";
      expect(contrastText(hex)).toBe(optimal);
    }
  });

  it("SC 1.4.3 (ADR-0024): on-fill label contrast holds its documented floor at ~0.9 opacity, both themes", () => {
    let worst = Infinity;
    for (const surface of ["#ffffff", "#17232a"]) {
      for (const hex of PARTNER_SWATCHES) {
        worst = Math.min(worst, contrastRatio(contrastText(hex), composite(hex, PARTNER_FILL_OPACITY, surface)));
      }
    }
    // SC 1.4.3's fill-text bar is 4.5:1; these small map labels reach only ~3.74:1 worst
    // on the most saturated tints — an accepted exception (ADR-0024): haloed + redundantly
    // identified at solid AA (tooltip + companion). This floor is a regression tripwire
    // pinned just under the current worst; dropping below it forces a re-review (darken
    // the palette or add an opaque label backing).
    expect(worst).toBeGreaterThanOrEqual(3.7);
  });
});

describe("contrastHalo (F-19)", () => {
  it("F-19: returns the opposite translucent tone to the chosen label", () => {
    expect(contrastHalo("#000000")).toBe("rgba(0,0,0,0.3)"); // white label → dark halo
    expect(contrastHalo("#ffffff")).toBe("rgba(255,255,255,0.6)"); // dark label → light halo
  });

  it("F-19: pairs with contrastText for every partner swatch", () => {
    for (const hex of PARTNER_SWATCHES) {
      const expected = contrastText(hex) === "#ffffff" ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.6)";
      expect(contrastHalo(hex)).toBe(expected);
    }
  });

  it("falls back to the dark-label pairing on unparseable input (never throws)", () => {
    expect(contrastHalo("not-a-color")).toBe("rgba(255,255,255,0.6)");
  });
});
