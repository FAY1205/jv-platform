// WS-8 / F-19 + WP-H / CON-01: WCAG contrast helpers. The relative-luminance and
// contrast-ratio math below is the ONE shared primitive for the whole app — the export
// renderer, the on-fill map label pick, and every contrast test import it (pinned to
// external WebAIM/W3C reference values by tests/unit/wcag.test.ts). Pure — same input ⇒
// same output; never throws; unknown input → treated as darkest (luminance 0 / dark text).

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

/**
 * "#111111" (dark) on light fills, "#ffffff" on dark fills — the higher-contrast choice by
 * the WCAG luminance-crossover threshold (~0.179). On-fill MAP labels (ADR-0024 carve-out):
 * intentionally near-black, not the export's pure-black ratio pick. Never throws → dark text.
 */
export function contrastText(hex: string): "#111111" | "#ffffff" {
  const rgb = parseHex(hex);
  if (!rgb) return "#111111";
  return relativeLuminance(hex) > 0.179 ? "#111111" : "#ffffff";
}

/**
 * Translucent halo tone that lifts an on-fill label off a busy partner fill.
 * Opposite tonal family to the label (WCAG-picked by contrastText): white label
 * (dark fill) → dark halo; dark label (light fill) → light halo. Pure; never throws.
 */
export function contrastHalo(hex: string): string {
  return contrastText(hex) === "#ffffff" ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.6)";
}
