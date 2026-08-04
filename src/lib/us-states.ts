// Client-safe canonical US state list (50 states + DC) — THE one home for state
// codes and names (PRN-15): the coverage model, the portal territory builder, and
// the picker Comboboxes all read from here; no second hand-typed list to drift.
// D1 (2026-07-15): this data lived in lib/geo/us-hexgrid.ts until the hex cartogram
// renderer was retired; the geometry went with it, the dataset moved here.
// US_STATE_DATA keeps the original code order — buildStateCoverage /
// buildPartnerTerritory iterate it, so their output (and the /api/coverage response
// array) order depends on it. US_STATES is the name-sorted picker view.

export interface UsState {
  code: string;
  name: string;
}

/** Canonical dataset, CODE order (load-bearing for coverage-model output order). */
export const US_STATE_DATA: readonly UsState[] = [
  { code: "AK", name: "Alaska" },
  { code: "AL", name: "Alabama" },
  { code: "AR", name: "Arkansas" },
  { code: "AZ", name: "Arizona" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DC", name: "District of Columbia" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "IA", name: "Iowa" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "MA", name: "Massachusetts" },
  { code: "MD", name: "Maryland" },
  { code: "ME", name: "Maine" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MO", name: "Missouri" },
  { code: "MS", name: "Mississippi" },
  { code: "MT", name: "Montana" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "NE", name: "Nebraska" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NV", name: "Nevada" },
  { code: "NY", name: "New York" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VA", name: "Virginia" },
  { code: "VT", name: "Vermont" },
  { code: "WA", name: "Washington" },
  { code: "WI", name: "Wisconsin" },
  { code: "WV", name: "West Virginia" },
  { code: "WY", name: "Wyoming" },
];

/** Name-sorted view for pickers (T2: the searchable state filter). */
export const US_STATES: readonly UsState[] = [...US_STATE_DATA].sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(US_STATE_DATA.map((s) => [s.code, s.name]));

/** Full state name for a 2-letter code; falls back to the code itself. */
export function stateName(code: string): string {
  return BY_CODE.get(code.toUpperCase()) ?? code;
}
