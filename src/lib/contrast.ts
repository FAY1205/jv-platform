// WS-8 / F-19: choose a readable label color for text drawn on a colored fill (partner
// tints on the coverage map). Pure — WCAG relative luminance, black vs white by the
// contrast-crossover threshold (~0.179). Never throws; unknown input → dark text.

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** "#111111" (dark) on light fills, "#ffffff" on dark fills — the higher-contrast choice. */
export function contrastText(hex: string): "#111111" | "#ffffff" {
  const rgb = parseHex(hex);
  if (!rgb) return "#111111";
  return relativeLuminance(rgb) > 0.179 ? "#111111" : "#ffffff";
}

/**
 * Translucent halo tone that lifts an on-fill label off a busy partner fill.
 * Opposite tonal family to the label (WCAG-picked by contrastText): white label
 * (dark fill) → dark halo; dark label (light fill) → light halo. Pure; never throws.
 */
export function contrastHalo(hex: string): string {
  return contrastText(hex) === "#ffffff" ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.6)";
}
