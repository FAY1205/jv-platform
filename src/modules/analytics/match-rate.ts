// Dashboard hero figures (ANA-01). PURE — no I/O, no Date.now() (PRN-01). The
// single home of these numbers (PRN-15); the page only formats them.

/** Fraction in [0,1] of KEPT leads matched to a partner — distributed / (distributed
 *  + unmatched); null when there are no kept leads, so callers render an em dash
 *  instead of a meaningless "0%". */
export function matchRate(distributed: number, unmatched: number): number | null {
  const kept = distributed + unmatched;
  if (kept <= 0) return null;
  return distributed / kept;
}

/** Whole-percent display of the match rate; "—" when null. */
export function formatMatchRatePct(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

/** ANA-03/UXQ-05: the one human definition of the hero match-rate figure.
 *  Plain language per owner testing note #1 (2026-07-14): tooltips must be simple. */
export const MATCH_RATE_DEFINITION =
  "Of the leads kept after MLS filtering, the share that landed with a partner. " +
  "The rest are unmatched — no partner covers their area yet.";
