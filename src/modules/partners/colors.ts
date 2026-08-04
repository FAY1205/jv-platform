import { PARTNER_SWATCHES } from "@/lib/tokens/tokens";

// PRN-06/14: assign a partner's locked color from the swatch pool. Prefer the
// first color not already in use; if the pool is exhausted, cycle rather than
// hard-fail (color is never the sole signal — name + PR-### always accompany it).

/** Pick a locked color for a new partner, avoiding colors already assigned. */
export function pickPartnerColor(usedHexes: readonly string[]): string {
  const used = new Set(usedHexes.map((h) => h.toLowerCase()));
  const free = PARTNER_SWATCHES.find((c) => !used.has(c.toLowerCase()));
  if (free) return free;
  // Exhausted: deterministically reuse from the pool so creation never blocks.
  return PARTNER_SWATCHES[used.size % PARTNER_SWATCHES.length];
}
