// Unmatched-inbox shaping (ASN-03). PURE — no I/O (PRN-01). Groups gap leads by
// state, biggest gap first, so "assign a partner here" is an obvious decision.

export interface UnmatchedLead {
  refId: string;
  seller: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  campaign: string | null;
  receivedAt: string;
}

export interface UnmatchedGroup {
  state: string;
  count: number;
  /** Distinct ZIPs in this state's gap, sorted — the "coverage hole" footprint. */
  zips: string[];
  leads: UnmatchedLead[];
}

const NO_STATE = "—";

export function groupUnmatchedByState(leads: readonly UnmatchedLead[]): UnmatchedGroup[] {
  const byState = new Map<string, UnmatchedLead[]>();
  for (const lead of leads) {
    const key = lead.state && lead.state.trim() ? lead.state.trim().toUpperCase() : NO_STATE;
    const list = byState.get(key) ?? [];
    list.push(lead);
    byState.set(key, list);
  }

  const groups: UnmatchedGroup[] = [...byState.entries()].map(([state, groupLeads]) => ({
    state,
    count: groupLeads.length,
    zips: [...new Set(groupLeads.map((l) => l.zip).filter((z): z is string => Boolean(z)))].sort(),
    leads: groupLeads,
  }));

  // Biggest gap first; the "no state" bucket always sinks to the bottom.
  return groups.sort((a, b) => {
    if (a.state === NO_STATE) return 1;
    if (b.state === NO_STATE) return -1;
    return b.count - a.count || a.state.localeCompare(b.state);
  });
}
