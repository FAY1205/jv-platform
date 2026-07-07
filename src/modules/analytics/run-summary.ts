import type { MatchMethod } from "../pipeline/assign";

// ─────────────────────────────────────────────────────────────────────────────
// Run summary (EXP-04). The SINGLE home of these computed statistics (PRN-15) —
// both the export's Run_Summary sheet (WP-016) and the on-screen summary (WP-019)
// consume this one function; no number is re-derived elsewhere. PURE (PRN-01).
// ─────────────────────────────────────────────────────────────────────────────

export interface RunSummaryLead {
  mlsStatus: "kept" | "removed";
  matchMethod: MatchMethod;
  partnerId: string | null;
  previouslyMatched: boolean;
}

export interface RunSummary {
  total: number;
  kept: number;
  removed: number;
  unmatched: number;
  previouslyMatched: number;
  /** Delivered (kept + assigned) leads per partner, sorted by partnerId for determinism. */
  perPartner: { partnerId: string; count: number }[];
}

export function computeRunSummary(leads: readonly RunSummaryLead[]): RunSummary {
  let kept = 0;
  let removed = 0;
  let unmatched = 0;
  let previouslyMatched = 0;
  const perPartner = new Map<string, number>();

  for (const lead of leads) {
    if (lead.mlsStatus === "kept") kept++;
    else removed++;
    if (lead.matchMethod === "none") unmatched++;
    if (lead.previouslyMatched) previouslyMatched++;

    // Per-partner counts only the delivered leads: kept AND assigned to a partner.
    if (lead.mlsStatus === "kept" && lead.partnerId !== null) {
      perPartner.set(lead.partnerId, (perPartner.get(lead.partnerId) ?? 0) + 1);
    }
  }

  return {
    total: leads.length,
    kept,
    removed,
    unmatched,
    previouslyMatched,
    perPartner: [...perPartner.entries()]
      .map(([partnerId, count]) => ({ partnerId, count }))
      .sort((a, b) => (a.partnerId < b.partnerId ? -1 : a.partnerId > b.partnerId ? 1 : 0)),
  };
}
