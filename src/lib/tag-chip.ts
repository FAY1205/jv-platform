import { cn } from "@/lib/cn";
import { isTagColor, type TagColor } from "@/lib/tokens/tokens";

// WP-TAG-1 (TAG-04) — the tag-chip color vocabulary. The status-pill.ts shape applied to
// tags: a palette KEY (stored on the row) resolves to Tailwind SEMANTIC-TOKEN utilities
// here, so no component ever names a hex (PRN-12) and a theme swap re-tints every chip for
// free. One map, three surfaces (list rows, board cards, Settings swatches).
//
// PRN-14: color is never the only signal — every chip renders its NAME, and the Settings
// swatches carry the palette key as their accessible label.

/** [soft fill + ink text + tinted border] per palette key. */
const TAG_CHIP: Record<TagColor, string> = {
  teal: "bg-success-soft text-success border-success/45",
  blue: "bg-info-soft text-info border-info/45",
  amber: "bg-warn-soft text-warn border-warn/45",
  plum: "bg-prev-soft text-prev border-prev/45",
  rose: "bg-danger-soft text-danger border-danger/45",
  gold: "bg-brand-soft text-brand-ink border-brand-line",
};

/** Solid dot/swatch fill per palette key — the picker bullets and the Settings swatches.
 *  Decorative only; the label always sits beside it (PRN-14). */
const TAG_DOT: Record<TagColor, string> = {
  teal: "bg-success",
  blue: "bg-info",
  amber: "bg-warn",
  plum: "bg-prev",
  rose: "bg-danger",
  gold: "bg-brand",
};

/** Shape + size shared by every tag chip (matches the status pill's rhythm, one notch
 *  tighter — a row can carry several). */
const TAG_CHIP_BASE =
  "inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold";

/** Full className for a tag chip. An unknown/legacy key degrades to a neutral chip rather
 *  than rendering unstyled — data outlives palettes. */
export function tagChipClass(color: string, extra?: string): string {
  return cn(TAG_CHIP_BASE, isTagColor(color) ? TAG_CHIP[color] : "bg-surface-3 text-text-2 border-border", extra);
}

/** Tailwind background utility for a tag's dot/swatch (neutral fallback for an unknown key). */
export function tagDotClass(color: string): string {
  return isTagColor(color) ? TAG_DOT[color] : "bg-text-3";
}
