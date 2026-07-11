// Shared Survey map styling (WP-D). Consumed by CoverageMap (hex) and
// CountyCoverageMap (county) so the two maps read identically in both themes.

/** Covered-territory fill opacity — the survey-paper softening (DIRECTION §Signature). */
export const PARTNER_FILL_OPACITY = 0.9;

/**
 * Explore-mode dim level for non-selected territory, shared by both maps so the
 * "highlight a partner" interaction dims by the same amount everywhere. (The hex
 * map applies it as group opacity — dimming stroke + label too — while the county
 * map applies it as fill-opacity; unifying that *mechanism* is a tracked follow-up.)
 */
export const DIMMED_FILL_OPACITY = 0.28;
