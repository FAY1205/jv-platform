import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  lightColors,
  darkColors,
  PARTNER_PALETTE,
  type ColorTokens,
} from "@/lib/tokens/tokens";

const globalsCss = readFileSync(
  fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)),
  "utf8",
);

// camelCase token key → CSS custom-property name (surface2 → --surface-2).
const toCssVar = (key: string) =>
  "--" + key.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

// WP-003 / SEAM-08: the CSS token layer and tokens.ts must not drift apart.
describe("DSN-01/SEAM-08: design tokens", () => {
  it("declares a CSS variable in globals.css for every semantic color token", () => {
    const missing = (Object.keys(lightColors) as (keyof ColorTokens)[])
      .map(toCssVar)
      .filter((cssVar) => !globalsCss.includes(`${cssVar}:`));
    expect(missing).toEqual([]);
  });

  it("maps every semantic color into a Tailwind theme utility", () => {
    const unmapped = (Object.keys(lightColors) as (keyof ColorTokens)[])
      .filter((k) => k !== "scrim") // scrim is used directly, not as a bg/text utility
      .map((k) => `--color-${toCssVar(k).slice(2)}`)
      .filter((themeVar) => !globalsCss.includes(`${themeVar}:`));
    expect(unmapped).toEqual([]);
  });

  it("defines matching light and dark values for every color role", () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it("ships a dark theme via both system preference and explicit override", () => {
    expect(globalsCss).toContain('prefers-color-scheme: dark');
    expect(globalsCss).toContain(':root[data-theme="dark"]');
  });
});

// WP-003 / PRN-06 & PRN-14: locked, distinct partner colors.
describe("SET-02: partner palette", () => {
  it("seeds the locked 9-partner roster with valid hex colors", () => {
    expect(PARTNER_PALETTE).toHaveLength(9);
    for (const p of PARTNER_PALETTE) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("assigns a unique color per partner", () => {
    const hexes = PARTNER_PALETTE.map((p) => p.hex.toLowerCase());
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});
