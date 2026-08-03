import crosswalkData from "./data/zip-county.json";

// WP-E (owner note #6): ZIP5 → county FIPS crosswalk. A partner's (or the house's) ZIP coverage
// is entered as bare ZIPs; to color the COUNTY a partner covers (not just tint the whole state),
// each covered ZIP is resolved to the 5-digit county FIPS the county geometry
// (public/geo/us-counties.json) is keyed by. This is DATA (PRN-10) — server-only, loaded once.
//
// The mapping is ZIP → PRIMARY county (a ZIP can span counties; the crosswalk picks the dominant
// one). data/zip-county.json currently holds a small fixture; the full ~40k-ZIP dataset is a
// drop-in replacement of that one file — see docs and the loader below, nothing else changes.
const crosswalk = crosswalkData as Record<string, string>;

/** The county FIPS a ZIP5 falls in, or null if the ZIP isn't in the crosswalk. */
export function zipToCounty(zip5: string): string | null {
  return crosswalk[zip5] ?? null;
}

/** Number of ZIPs the crosswalk currently knows (diagnostics; distinguishes the fixture from the
 *  full dataset at a glance). */
export function crosswalkSize(): number {
  return Object.keys(crosswalk).length;
}
