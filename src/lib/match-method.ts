// Client-safe shared type + exhaustive display map for how a lead was routed (F-57).
// Mirrors db `matchMethodEnum` = ["zip","state_fallback","none"]. Manual assignment is a
// separate overlay (leads.manual_partner_id), not a match_method value. `badge` values are
// a subset of the Badge component's variant union (kept as a local literal to avoid a
// lib→components import); this is the single source for both the label and its chip color.

export type MatchMethod = "zip" | "state_fallback" | "none";
export type MatchMethodBadge = "zip" | "state" | "neutral";

export const MATCH_METHOD_LABEL: Record<MatchMethod, { label: string; badge: MatchMethodBadge }> = {
  zip: { label: "ZIP match", badge: "zip" },
  state_fallback: { label: "State fallback", badge: "state" },
  none: { label: "No match", badge: "neutral" },
};

/** Never throws — an unknown value degrades to a neutral "Unknown" chip. */
export function matchMethodLabel(m: string): { label: string; badge: MatchMethodBadge } {
  return MATCH_METHOD_LABEL[m as MatchMethod] ?? { label: "Unknown", badge: "neutral" };
}
