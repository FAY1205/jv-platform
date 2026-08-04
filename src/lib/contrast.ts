// WP-H / CON-01: WCAG contrast helpers. The relative-luminance and contrast-ratio math
// below is the ONE shared primitive for the whole app — the export renderer and every
// contrast test import it (pinned to external WebAIM/W3C reference values by
// tests/unit/wcag.test.ts). Pure — same input ⇒ same output; never throws; unknown
// input → treated as darkest (luminance 0).
// D1 (2026-07-15): contrastText/contrastHalo (the hex map's on-fill label policy,
// F-19/ADR-0024) were removed with the retired CoverageMap — the county map identifies
// states via tooltip + companion list, not on-fill labels. The export renderer keeps
// its OWN separate contrastText policy in modules/export/render.ts (WP-H: policies
// distinct, only this low-level math is shared).

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** WCAG 2.x relative luminance of an #RGB / #RRGGBB color. Unparseable → 0 (never throws). */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const lin = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two colors: (Lmax + 0.05) / (Lmin + 0.05). Pure; never throws. */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
