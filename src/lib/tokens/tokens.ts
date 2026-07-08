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

export const lightColors: ColorTokens = {
  bg: "#f6f7f7",
  surface: "#ffffff",
  surface2: "#fafbfb",
  surface3: "#f2f4f4",
  border: "#e4e8e7",
  borderSoft: "#edf0ef",
  text: "#0f1722",
  text2: "#445062",
  text3: "#8b95a5",
  brand: "#0d7a6a",
  brandStrong: "#0a5f53",
  brandSoft: "#e8f3f0",
  brandLine: "#cfe6e0",
  info: "#4f5bd5",
  infoSoft: "#edeffc",
  danger: "#c2333b",
  dangerSoft: "#fbebec",
  warn: "#b25107",
  warnSoft: "#fdf2e2",
  success: "#0d7a6a",
  successSoft: "#e8f3f0",
  prev: "#6d4a9e",
  prevSoft: "#f2ecfa",
  scrim: "rgba(15,23,34,.4)",
};

export const darkColors: ColorTokens = {
  bg: "#0e1214",
  surface: "#151a1d",
  surface2: "#181e21",
  surface3: "#1d2427",
  border: "#242c30",
  borderSoft: "#1d2528",
  text: "#eef2f1",
  text2: "#a9b4ba",
  text3: "#6c787f",
  brand: "#2aa38e",
  brandStrong: "#3cb9a2",
  brandSoft: "#12312b",
  brandLine: "#1c4a41",
  info: "#8b95ec",
  infoSoft: "#20244a",
  danger: "#e06d74",
  dangerSoft: "#3a1d20",
  warn: "#e0964c",
  warnSoft: "#3a2a15",
  success: "#2aa38e",
  successSoft: "#12312b",
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
