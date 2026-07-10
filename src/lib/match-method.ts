// Client-safe shared type + exhaustive display map for how a lead was routed (F-57).
// Mirrors db `matchMethodEnum` = ["zip","state_fallback","none"]. Manual assignment is a
// separate overlay (leads.manual_partner_id), not a match_method value.

export type MatchMethod = "zip" | "state_fallback" | "none";

export const MATCH_METHOD_LABEL: Record<MatchMethod, { label: string; tone: "success" | "info" | "neutral" }> = {
  zip: { label: "ZIP match", tone: "success" },
  state_fallback: { label: "State fallback", tone: "info" },
  none: { label: "No match", tone: "neutral" },
};

/** Never throws — an unknown value degrades to a neutral "Unknown" chip. */
export function matchMethodLabel(m: string): { label: string; tone: "success" | "info" | "neutral" } {
  return MATCH_METHOD_LABEL[m as MatchMethod] ?? { label: "Unknown", tone: "neutral" };
}
