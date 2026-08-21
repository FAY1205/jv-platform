import type { LeadsFilterState } from "./filter-wire";
import { isDefaultStatuses } from "./schema";

// N6-53 — "the filter, named in words". An escalated selection commits an operator to a set
// they cannot see, so the confirmation has to SAY which set: "all 641 leads matching Texas ·
// Hot only" reads as a decision, "all 641 matching this filter" reads as a leap of faith.
//
// PURE, and deliberately outside the component tree: PR B's `Selection_Summary` sheet needs
// the same sentence (N6-42), and a renderer that had to reach into React to get it would end
// up with a second, drifting copy. Names arrive as data — this module never looks anything up.

/** Display names the caller already has (the partner roster, the tag roster). A missing
 *  entry degrades to the id rather than dropping the clause — a filter that is ACTIVE must
 *  never be invisible in the sentence that justifies a bulk write. */
export interface FilterNames {
  partners?: ReadonlyMap<string, string>;
  tags?: ReadonlyMap<string, string>;
}

/** The sentinel the partner filter uses for "unmatched only" (mirrors the query layer). */
const UNMATCHED = "unmatched";

/**
 * The active filters as a short list of clauses. Empty when nothing is filtering — the caller
 * says "all leads" rather than "leads matching ".
 */
export function filterClauses(f: LeadsFilterState, names: FilterNames = {}): string[] {
  const out: string[] = [];
  if (f.q) out.push(`search “${f.q}”`);
  if (f.partnerId === UNMATCHED) out.push("unmatched only");
  else if (f.partnerId) out.push(`partner ${names.partners?.get(f.partnerId) ?? f.partnerId}`);
  if (f.state) out.push(f.state);
  if (f.source) out.push(`source ${f.source}`);
  if (f.hot) out.push("Hot only");
  if (f.tags.length > 0) out.push(`tagged ${f.tags.map((id) => names.tags?.get(id) ?? id).join(", ")}`);
  // The DEFAULT status selection is what the page opens with, so naming it would put a
  // clause in front of every escalation that the operator never chose.
  if (f.statuses.length > 0 && !isDefaultStatuses(f.statuses)) out.push(`status ${f.statuses.join(", ")}`);
  if (f.dateFrom && f.dateTo) out.push(`received ${f.dateFrom} to ${f.dateTo}`);
  else if (f.dateFrom) out.push(`received from ${f.dateFrom}`);
  else if (f.dateTo) out.push(`received up to ${f.dateTo}`);
  return out;
}

/** One sentence fragment naming the filter, or "" when nothing is filtering. */
export function describeFilters(f: LeadsFilterState, names: FilterNames = {}): string {
  return filterClauses(f, names).join(" · ");
}
