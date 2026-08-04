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
  /** stronger hairline for table rules / dividers (Survey line-strong) */
  borderStrong: string;
  text: string;
  text2: string;
  text3: string;
  /** marigold — the signature FILL (buttons, focal fills, active states) */
  brand: string;
  brandStrong: string;
  brandSoft: string;
  brandLine: string;
  /** amber ink — the accent as TEXT/links (AA on paper); marigold is too light to read */
  brandInk: string;
  /** fixed near-black for TEXT on the marigold fill (buttons/checkbox). Theme-invariant —
   *  --text flips to near-white in dark and cannot read on the mid-tone marigold. */
  brandContrast: string;
  /** text ON a solid status FILL (danger/success buttons + toasts). Theme-FLIPPING:
   *  near-white in light, near-black in dark — hardcoded white-on-fill fails AA in dark. */
  onStatus: string;
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
  /** hairline on a partner-color swatch — theme-FLIPPING (dark edge in light, light edge in
   *  dark, so the swatch keeps a crisp boundary on dark cards). Direct-use, like `scrim`:
   *  applied as an inline border color / raw email value; no Tailwind utility. */
  swatchBorder: string;
  scrim: string;
}

// "Survey" identity v2 (2026-07, ADR-0022): cool petrol-paper neutrals, one marigold
// signal (route), petrol ink, status colors kept separate from the accent. Neutrals are
// biased toward the ink's petrol hue (chosen, not default grey). Var *names* are kept
// (keep-names decision); only values change, + two additive roles (borderStrong,
// brandInk). All pairs AA-verified in both themes by tests/unit/tokens.test.ts.
export const lightColors: ColorTokens = {
  bg: "#F1F4F3",
  surface: "#FFFFFF",
  surface2: "#E9EEEC",
  surface3: "#DDE5E2",
  border: "#D3DCD9",
  borderSoft: "#E4E9E7",
  borderStrong: "#B8C4C0",
  text: "#16242B",
  text2: "#46565D",
  // ink-3: AA (≥4.5:1) on both surface (#fff) and paper.
  text3: "#566268",
  // brand = the marigold FILL only (buttons/focal fills). It is deliberately too light
  // to read as text; amber TEXT/links use brandInk (route-ink) instead.
  brand: "#E0912B",
  brandStrong: "#C67D1E",
  brandSoft: "#FAEFDA",
  brandLine: "#EAD8AE",
  brandInk: "#8F5416",
  brandContrast: "#20160A",
  onStatus: "#FFFFFF",
  info: "#2E6E93",
  infoSoft: "#E7EFF4",
  danger: "#B23A2E",
  dangerSoft: "#F7E4E1",
  // warn darkened from DIRECTION's #B9741C (3.76:1) to clear the ≥4.5 body-text gate.
  warn: "#985E15",
  warnSoft: "#F7EEDA",
  success: "#2C7A57",
  successSoft: "#E8F2EC",
  // previously-matched: warm stone/taupe (Survey bans purple) — a pencil-annotation read.
  prev: "#6E5C46",
  prevSoft: "#EFE8DE",
  swatchBorder: "rgba(0,0,0,0.18)",
  scrim: "rgba(22,36,43,.4)",
};

export const darkColors: ColorTokens = {
  bg: "#10181C",
  surface: "#17232A",
  surface2: "#1E2C33",
  surface3: "#26363E",
  border: "#2A3A41",
  borderSoft: "#223038",
  borderStrong: "#3A4D55",
  text: "#EAF0EE",
  text2: "#A9B8BC",
  text3: "#85969B",
  brand: "#F0A63E",
  brandStrong: "#F6B856",
  brandSoft: "#2A2417",
  brandLine: "#4A3A1E",
  brandInk: "#F0A63E",
  brandContrast: "#20160A",
  onStatus: "#20160A",
  info: "#5FA0C8",
  infoSoft: "#1A2A33",
  danger: "#E06555",
  dangerSoft: "#301E1B",
  warn: "#E0973A",
  warnSoft: "#33291A",
  success: "#4FB183",
  successSoft: "#173529",
  prev: "#CBB89C",
  prevSoft: "#2A251E",
  swatchBorder: "rgba(255,255,255,0.22)",
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

/** Elevation levels 0–3 + assistant ambient/upward (WP-AI-2) — subtle, no heavy drops (DSN-01). */
export const elevation = {
  xs: "0 1px 2px rgba(15,23,34,.04)",
  sm: "0 1px 2px rgba(15,23,34,.05),0 1px 3px rgba(15,23,34,.04)",
  md: "0 4px 12px rgba(15,23,34,.07),0 1px 3px rgba(15,23,34,.05)",
  lg: "0 16px 40px rgba(15,23,34,.14),0 4px 12px rgba(15,23,34,.08)",
  amb: "0 8px 20px rgba(22,36,43,.2)",
  up: "0 -2px 10px rgba(22,36,43,.05)",
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
 * Raw email-safe font stacks (SEAM-08, PRN-12). Emails cannot load the app's
 * next/font faces (Fraunces/Hanken/IBM Plex Mono) and cannot read CSS variables,
 * so the email shell (src/modules/notify/email-template.ts) inlines these literal
 * fallbacks. This is the single source for the email typeface intent — same role
 * as `typography` for CSS, so a rebrand/white-label (SET-09) updates one file.
 */
export const emailFonts = {
  display: "Georgia, 'Times New Roman', serif",
  body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'SF Mono', ui-monospace, 'Roboto Mono', Menlo, Consolas, monospace",
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
  { name: "Michael Pinter", hex: "#B4623F" }, // clay
  { name: "Blake McCreight", hex: "#6E8B5E" }, // sage
  { name: "Josh Ax", hex: "#5B7A9E" }, // slate-blue
  { name: "Jeff Lister", hex: "#8A5A78" }, // plum
  { name: "Dylan Tanaka", hex: "#3E8C8A" }, // teal
  { name: "Randy Wolfe", hex: "#A65A34" }, // rust
  { name: "Joe Lieber", hex: "#57794C" }, // moss
  { name: "Forrest McGhee", hex: "#47688E" }, // denim
  { name: "Jason Beery", hex: "#9E4B45" }, // brick
] as const;

/**
 * WP-D (ADR-0037): the reserved color for the tenant's own "house" territory. A neutral
 * graphite deliberately OUTSIDE the partner tint pool below, so house coverage reads as
 * "yours, not a partner's" on every map and roster. Stays AA with white text via contrastText.
 */
export const HOUSE_COLOR = "#3A3F4B";

/**
 * The partner swatch pool (SET-02, ADR-0022) — the Survey "printed-map region"
 * palette: muted, distinguishable tints that stay AA as row/legend fills (the
 * export picks black/white text per fill via contrastText). New partners created
 * in-app (ADM-03) get the first unused color from this ordered, locked pool
 * (PRN-06); color is never the sole signal (always paired with name + PR-###).
 * Roster 9 first, then ochre (held back from the seed so it doesn't read as the
 * route marigold), then further vetted map tints for headroom.
 */
export const PARTNER_SWATCHES: readonly string[] = [
  ...PARTNER_PALETTE.map((p) => p.hex),
  "#C79A3E", // ochre
  "#3E6B52", // pine
  "#7A3B45", // wine
  "#2F6E7A", // harbor
  "#8A7B57", // dust
  "#6B4A66", // fig
  "#6E7A3E", // olive
  "#B08A52", // sand
  "#3E5A7A", // indigo-slate
  "#B5764C", // terracotta
  "#5E9E8E", // seafoam
] as const;

export const themes = { light: lightColors, dark: darkColors } as const;
export type ThemeName = keyof typeof themes;
