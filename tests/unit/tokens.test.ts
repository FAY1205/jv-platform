import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";
import {
  lightColors,
  darkColors,
  PARTNER_PALETTE,
  PARTNER_SWATCHES,
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

  const DIRECT_ONLY = new Set<keyof ColorTokens>([
    // Applied directly, not as bg/text/border Tailwind utilities → no --color-* mapping.
    "scrim", "swatchBorder",
    // WP-UX-8: the map tokens are consumed as raw var() in SVG fill/stroke attributes, so they
    // deliberately carry no Tailwind utility (skipping @theme avoids dead --color-map-* utilities).
    "mapLine", "mapLand", "mapLandLine",
  ]);

  it("maps every semantic color into a Tailwind theme utility", () => {
    const unmapped = (Object.keys(lightColors) as (keyof ColorTokens)[])
      .filter((k) => !DIRECT_ONLY.has(k))
      .map((k) => `--color-${toCssVar(k).slice(2)}`)
      .filter((themeVar) => !globalsCss.includes(`${themeVar}:`));
    expect(unmapped).toEqual([]);
  });

  it("WP-UX-8: the map tokens are declared in all three theme blocks and light is a no-op", () => {
    for (const v of ["--map-line", "--map-land", "--map-land-line"]) {
      const count = globalsCss.split(`${v}:`).length - 1;
      expect(count, `${v} should be declared in light + both dark blocks`).toBeGreaterThanOrEqual(3);
    }
    // Light values equal the values the map rendered before this pass → zero light-mode change.
    expect(lightColors.mapLine).toBe("#FFFFFF");
    expect(lightColors.mapLand).toBe(lightColors.surface3);
    expect(lightColors.mapLandLine).toBe(lightColors.borderStrong);
  });

  it("defines matching light and dark values for every color role", () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it("CON-03: swatchBorder is a dark edge in light and a light (inverted-channel) edge in dark", () => {
    // WP-H: theme-flipping hairline on a partner swatch. The inverted channel (black→white)
    // is more error-prone than a same-channel hex swap, so pin both values explicitly.
    expect(lightColors.swatchBorder).toBe("rgba(0,0,0,0.18)");
    expect(darkColors.swatchBorder).toBe("rgba(255,255,255,0.22)");
  });

  it("ships a dark theme via both system preference and explicit override", () => {
    expect(globalsCss).toContain('prefers-color-scheme: dark');
    expect(globalsCss).toContain(':root[data-theme="dark"]');
  });

  it("DSN-02: root font-size is 100% (16px default, respecting user zoom) and the three next/font faces are wired", () => {
    // WCAG 1.4.4: root is `100%` (not a hardcoded 16px) so a user's browser text-size
    // preference flows through the rem scale. 100% === 16px for the default browser setting.
    expect(globalsCss).toContain("font-size: 100%");
    expect(globalsCss).toContain("--font-fraunces");
    expect(globalsCss).toContain("--font-hanken");
    expect(globalsCss).toContain("--font-plex-mono");
  });

  it("WP-AI-2: declares the additive assistant elevation/glow tokens in both themes", () => {
    // --halo (orb glow), --sh-amb (launcher ambient), --sh-up (footer top-shadow).
    for (const v of ["--halo", "--sh-amb", "--sh-up"]) {
      // once in :root (light) + once in each dark block ⇒ ≥3 declarations.
      const count = globalsCss.split(`${v}:`).length - 1;
      expect(count, `${v} should be declared in light + both dark blocks`).toBeGreaterThanOrEqual(3);
    }
    expect(globalsCss).toContain("--shadow-amb:");
    expect(globalsCss).toContain("--shadow-up:");
    expect(globalsCss).toContain("@keyframes assistant-breathe");
  });
});

// F-17/F-18 (WCAG SC 1.4.3): text/status tokens meet AA against their background.
// The regression gate so a future token edit cannot silently drop a role below AA. Badge
// variants pair text-<t> on bg-<t>-soft (see Badge.tsx); text-3 must read on both surface
// and bg in both themes. WP-H / CON-01: contrastRatio is the ONE shared WCAG primitive
// (src/lib/contrast.ts), independently pinned to WebAIM reference values by wcag.test.ts —
// so this data gate is not grading the contrast function against itself.

describe("F-17/F-18: token contrast meets WCAG AA (4.5:1)", () => {
  for (const [theme, t] of [["light", lightColors], ["dark", darkColors]] as const) {
    it(`${theme}: body text roles read on their surfaces`, () => {
      expect(contrastRatio(t.text, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.text2, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.text3, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.text3, t.bg)).toBeGreaterThanOrEqual(4.5);
      // Survey: `brand` is the marigold FILL; amber text/links use `brandInk`.
      expect(contrastRatio(t.brandInk, t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.brandInk, t.surface)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme}: every Badge variant's text reads on its fill`, () => {
      // Survey badge semantics: the text token reads on its soft fill.
      const pairs: [string, string][] = [
        [t.brandInk, t.brandSoft], // ZIP-match / Contacted pill (marigold wash, amber-ink text)
        [t.info, t.infoSoft], // New
        [t.warn, t.warnSoft], // Unmatched
        [t.danger, t.dangerSoft], // Removed
        [t.success, t.successSoft], // Matched
        [t.prev, t.prevSoft], // Previously matched (taupe)
        [t.text2, t.surface3], // neutral
      ];
      for (const [fg, bg] of pairs) {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${theme}: WP-AI-2 — assistant widget's new token pairings meet AA`, () => {
      // Regression gate for the pairings the assistant widget introduced: source
      // chips (text-3 on surface-2), the cap-band settings link (brand-ink on
      // warn-soft), and the user message bubble (text on brand-soft).
      expect(contrastRatio(t.text3, t.surface2)).toBeGreaterThanOrEqual(4.5); // assistant source chips
      expect(contrastRatio(t.brandInk, t.warnSoft)).toBeGreaterThanOrEqual(4.5); // cap-band link
      expect(contrastRatio(t.text, t.brandSoft)).toBeGreaterThanOrEqual(4.5); // user message bubble
    });
    it(`${theme}: DSN-10/PRN-14 — fixed-dark text reads on the marigold fill; the focus ring meets non-text AA`, () => {
      // WP-C: primary Button + checkbox use the theme-invariant --brand-contrast on the
      // marigold fill (the flipping --text is near-white in dark → fails). Focus rings use
      // brand-ink (≥3:1 non-text on BOTH surface and paper) — brand-strong was 2.99 on paper.
      expect(contrastRatio(t.brandContrast, t.brand)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.brandInk, t.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.brandInk, t.bg)).toBeGreaterThanOrEqual(3);
    });
    it(`${theme}: CON-02 — on-fill status text meets AA on the danger + success fills`, () => {
      // WP-H: Button danger + Toast success/danger paint text on the SOLID status fill. The
      // theme-flipping `onStatus` token (white in light, near-black in dark) must clear 4.5:1
      // on both fills in both themes — hardcoded white-on-fill failed in dark (danger 3.41,
      // success 2.64). This is the regression gate for that fix.
      expect(contrastRatio(t.onStatus, t.danger)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.onStatus, t.success)).toBeGreaterThanOrEqual(4.5);
    });
  }
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

  it("SET-02: the swatch pool is a unique superset of the roster with headroom", () => {
    const pool = PARTNER_SWATCHES.map((c) => c.toLowerCase());
    for (const p of PARTNER_PALETTE) expect(pool).toContain(p.hex.toLowerCase());
    expect(new Set(pool).size).toBe(pool.length);
    expect(PARTNER_SWATCHES.length).toBeGreaterThanOrEqual(18);
  });
});
