// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — the single source of truth (DSN-01, SEAM-08, PRN-12).
//
// The UI consumes these as CSS variables (see src/app/globals.css, kept in sync
// and guarded by tests/unit/tokens.test.ts). Server-side consumers that cannot
// read CSS — the exceljs export legend (EXP-03) and Resend email templates
// (NTF-03) — import the raw values from THIS file. One definition, many surfaces.
//
// Rebranding or per-tenant white-label (SET-09) is a swap of these values, never
// a refactor: component code references semantic token names, never hex.
// ─────────────────────────────────────────────────────────────────────────────

/** Semantic color roles, resolved per theme. */
export interface ColorTokens {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderSoft: string;
  text: string;
  text2: string;
  text3: string;
  brand: string;
  brandStrong: string;
  brandSoft: string;
  brandLine: string;
  /** status: info */
  info: string;
  infoSoft: string;
  /** status: danger */
  danger: string;
  dangerSoft: string;
  /** status: warn */
  warn: string;
  warnSoft: string;
  /** status: success — the teal brand family doubles as success in this system */
  success: string;
  successSoft: string;
  /** accent for "previously matched" leads (DED-02) */
  prev: string;
  prevSoft: string;
  scrim: string;
}

// Minimal-slate identity (2026-07): cool slate neutrals on a #f8fafc canvas, a
// friendly green brand, semantic status colors kept distinct. Rebrand = swap here.
export const lightColors: ColorTokens = {
  bg: "#f8fafc",
  surface: "#ffffff",
  surface2: "#f5f8fb",
  surface3: "#eef2f7",
  border: "#e5eaf1",
  borderSoft: "#f0f4f8",
  text: "#1e2632",
  text2: "#5b6472",
  // Contrast pass (F-18): text3 darkened to ≥4.5:1 on both surface (#fff) and bg.
  text3: "#66707d",
  // Contrast pass (F-17): the brand teal darkened so text-brand/text-success on the
  // *-soft fills (zip/success badges, links) clears AA, keeping white-on-brand ≥4.5.
  brand: "#2c785d",
  brandStrong: "#276b54",
  brandSoft: "#e6f1eb",
  brandLine: "#c7e4d8",
  info: "#4f5bd5",
  infoSoft: "#edeffc",
  danger: "#b23a30",
  dangerSoft: "#f9e6e2",
  warn: "#8a5a12",
  warnSoft: "#f6edd9",
  success: "#2c785d",
  successSoft: "#e6f1eb",
  prev: "#6d4a9e",
  prevSoft: "#f2ecfa",
  scrim: "rgba(15,23,34,.4)",
};

export const darkColors: ColorTokens = {
  bg: "#0d1117",
  surface: "#151b23",
  surface2: "#1a212b",
  surface3: "#212a37",
  border: "#273140",
  borderSoft: "#1c2431",
  text: "#e8edf4",
  text2: "#a3adbb",
  // Contrast pass (F-18): text3 lightened to ≥4.5:1 on the dark surface + bg.
  text3: "#8a94a4",
  brand: "#4bb591",
  brandStrong: "#5cc5a1",
  brandSoft: "#123028",
  brandLine: "#1e4a3d",
  info: "#8b95ec",
  infoSoft: "#20244a",
  danger: "#e0776d",
  dangerSoft: "#3a201c",
  warn: "#d99a4a",
  warnSoft: "#3a2c15",
  success: "#4bb591",
  successSoft: "#123028",
  prev: "#ab8ad6",
  prevSoft: "#2c2140",
  scrim: "rgba(0,0,0,.55)",
};

/** Spacing scale on a 4/8px grid (DSN-01, DSN-09). */
export const spacing = {
  0: "0",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
} as const;

/** Radii scale (DSN-01). */
export const radii = {
  sm: "8px",
  md: "12px",
  lg: "16px",
  full: "9999px",
} as const;

/** Elevation levels 0–3 — subtle, no heavy drops (DSN-01). */
export const elevation = {
  xs: "0 1px 2px rgba(15,23,34,.04)",
  sm: "0 1px 2px rgba(15,23,34,.05),0 1px 3px rgba(15,23,34,.04)",
  md: "0 4px 12px rgba(15,23,34,.07),0 1px 3px rgba(15,23,34,.05)",
  lg: "0 16px 40px rgba(15,23,34,.14),0 4px 12px rgba(15,23,34,.08)",
} as const;

/** Motion durations + easing (DSN-01, DSN-08). */
export const motion = {
  fast: "120ms",
  base: "200ms",
  slow: "300ms",
  ease: "cubic-bezier(.2,.8,.2,1)",
} as const;

/**
 * Typography roles (DSN-02): display (headings/KPIs), UI/body, mono (IDs, ZIPs,
 * counts). The mono role carries the "ledger" identity — all numeric data is
 * tabular monospace. Font families are wired via next/font in the root layout.
 */
export const typography = {
  display: "var(--font-display)",
  body: "var(--font-sans)",
  mono: "var(--font-mono)",
} as const;

/**
 * Seeded partner palette (SET-02) — colors are assigned once and locked (PRN-06).
 * Every partner is identified by color AND a human-readable reference ID / name
 * (PRN-14); color is never the sole signal. This roster mirrors the demo seed.
 */
export interface PartnerColor {
  name: string;
  hex: string;
}

export const PARTNER_PALETTE: readonly PartnerColor[] = [
  { name: "Michael Pinter", hex: "#f4c95d" },
  { name: "Blake McCreight", hex: "#b9c4d6" },
  { name: "Josh Ax", hex: "#8fbfe8" },
  { name: "Jeff Lister", hex: "#f2a0b6" },
  { name: "Dylan Tanaka", hex: "#e5c07b" },
  { name: "Randy Wolfe", hex: "#e8927c" },
  { name: "Joe Lieber", hex: "#7fd1c8" },
  { name: "Forrest McGhee", hex: "#9cc69b" },
  { name: "Jason Beery", hex: "#c9a0dc" },
] as const;

/**
 * The partner swatch pool (SET-02). New partners created in-app (ADM-03) are
 * assigned the first unused color from this ordered, locked pool (PRN-06). Every
 * hue is a soft tint chosen to keep AA text contrast when used as a row/legend
 * fill (PRN-14) — color is never the sole signal (always paired with name +
 * JV-### ref-id). Starts with the seeded 9, then extends with more vetted tints.
 */
export const PARTNER_SWATCHES: readonly string[] = [
  ...PARTNER_PALETTE.map((p) => p.hex),
  "#a3c4a0", // sage
  "#e0b0d5", // orchid
  "#c7b299", // taupe
  "#8fc6d1", // aqua
  "#e8b98a", // apricot
  "#b6bce0", // periwinkle
  "#d9b8a0", // clay
  "#a8d0b9", // mint
  "#e3a9a9", // rose
  "#bcd08a", // pear
  "#9fb8e8", // cornflower
] as const;

export const themes = { light: lightColors, dark: darkColors } as const;
export type ThemeName = keyof typeof themes;
