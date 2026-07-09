// ─────────────────────────────────────────────────────────────────────────────
// Coverage-map view model (MAP-01). PURE — no I/O, no Date.now() (PRN-01).
//
// Colors each of the 51 hex states (50 + DC) by its state-fallback partner
// (state_rules; ASN-01), flags coverage gaps (leads from a state nobody owns),
// and builds the PRN-14 legend (partner name + JV ref accompany every color).
// The caller (queries.ts) fetches the rows; this only shapes them.
// ─────────────────────────────────────────────────────────────────────────────

import { US_HEX_STATES } from "@/lib/geo/us-hexgrid";

export interface StateRuleInput {
  state: string;
  partnerId: string;
}
export interface PartnerInput {
  id: string;
  name: string;
  refId: string;
  color: string;
}
export interface StateLeadCount {
  state: string;
  count: number;
}

export interface StateCoverage {
  code: string;
  name: string;
  partnerId: string | null;
  partnerName: string | null;
  refId: string | null;
  color: string | null;
  leadCount: number;
  /** Leads came from this state but no partner owns the state fallback (ASN-03). */
  gap: boolean;
}

export interface CoveragePartner {
  id: string;
  name: string;
  refId: string;
  color: string;
  stateCount: number;
}

export interface CoverageMapModel {
  states: StateCoverage[];
  coveredCount: number;
  gapCount: number;
  partners: CoveragePartner[];
}

export function buildStateCoverage(
  stateRules: readonly StateRuleInput[],
  partners: readonly PartnerInput[],
  leadCounts: readonly StateLeadCount[],
): CoverageMapModel {
  const partnerById = new Map(partners.map((p) => [p.id, p]));
  const ruleByState = new Map(stateRules.map((r) => [r.state, r.partnerId]));
  const leadsByState = new Map(leadCounts.map((l) => [l.state, l.count]));

  // Per-partner owned-state counts drive the legend.
  const stateCountByPartner = new Map<string, number>();
  for (const r of stateRules) {
    stateCountByPartner.set(r.partnerId, (stateCountByPartner.get(r.partnerId) ?? 0) + 1);
  }

  let coveredCount = 0;
  let gapCount = 0;

  const states: StateCoverage[] = US_HEX_STATES.map((hex) => {
    const partnerId = ruleByState.get(hex.code) ?? null;
    const partner = partnerId ? partnerById.get(partnerId) : undefined;
    const leadCount = leadsByState.get(hex.code) ?? 0;
    const gap = partnerId === null && leadCount > 0;
    if (partnerId) coveredCount += 1;
    if (gap) gapCount += 1;
    return {
      code: hex.code,
      name: hex.name,
      partnerId,
      partnerName: partner?.name ?? null,
      refId: partner?.refId ?? null,
      color: partner?.color ?? null,
      leadCount,
      gap,
    };
  });

  // Legend: only partners that own at least one state, ordered by JV ref for a
  // stable, deterministic order.
  const legend: CoveragePartner[] = partners
    .filter((p) => (stateCountByPartner.get(p.id) ?? 0) > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      refId: p.refId,
      color: p.color,
      stateCount: stateCountByPartner.get(p.id) ?? 0,
    }))
    .sort((a, b) => a.refId.localeCompare(b.refId));

  return { states, coveredCount, gapCount, partners: legend };
}
