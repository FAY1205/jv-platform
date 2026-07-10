import { describe, it, expect } from "vitest";
import { contrastText } from "@/lib/contrast";

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
