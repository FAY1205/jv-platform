import { US_HEX_STATES } from "./geo/us-hexgrid";

// Client-safe US state code↔name list, derived from the hexgrid dataset so there is
// exactly ONE home for state names (PRN-15) — no second hand-typed list to drift.
// Sorted by name for pickers (T2: the searchable state filter).

export interface UsState {
  code: string;
  name: string;
}

export const US_STATES: readonly UsState[] = US_HEX_STATES
  .map(({ code, name }) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(US_STATES.map((s) => [s.code, s.name]));

/** Full state name for a 2-letter code; falls back to the code itself. */
export function stateName(code: string): string {
  return BY_CODE.get(code.toUpperCase()) ?? code;
}
