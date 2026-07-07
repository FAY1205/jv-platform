import type { MatchMethod } from "./assign";

// ─────────────────────────────────────────────────────────────────────────────
// Dedupe & history (DED-01/02/03, PRN-05). PURE — no I/O, no Date.now() (PRN-01).
//
// Primary match is the dedupe_key (normalized address + zip5, DM-01). Phone (last-10)
// is a secondary CONFIRM only — it sets `phoneConfirmed`, and NEVER creates a match on
// its own (a matching phone at a different address is not a duplicate).
//
// PRN-05: history is never rewritten. A repeat lead reverts to its ORIGINAL partner +
// method and carries its first-matched date — a coverage change since then affects
// FUTURE new leads only, never an already-matched one.
// ─────────────────────────────────────────────────────────────────────────────

/** A prior-run lead as read from history. `firstMatchedAt` is DB data (ISO), not Date.now(). */
export interface HistoryEntry {
  partnerId: string | null;
  matchMethod: MatchMethod;
  firstMatchedAt: string;
  /** Last-10 phone of the original match, for the secondary confirm. */
  phoneNorm: string;
}

/** A current-run lead after normalize (WP-013) + assign (WP-014). */
export interface DedupeInput {
  dedupeKey: string;
  phoneNorm: string;
  partnerId: string | null;
  matchMethod: MatchMethod;
}

export interface DedupeResult {
  previouslyMatched: boolean;
  partnerId: string | null;
  matchMethod: MatchMethod;
  /** The original partner when previously matched; null for a fresh lead. */
  originalPartnerId: string | null;
  /** Carried from history (or the within-run original); null = new → the caller stamps it. */
  firstMatchedAt: string | null;
  /** Phone also matched the prior/original record (secondary confirm only). */
  phoneConfirmed: boolean;
  /** Within-run: index of the first occurrence this dup collapses onto; null otherwise. */
  duplicateOfIndex: number | null;
}

/** A key is dedupable only when BOTH address and zip are present (avoids false merges). */
function isDedupable(key: string): boolean {
  const sep = key.indexOf("|");
  if (sep < 0) return false;
  return key.slice(0, sep) !== "" && key.slice(sep + 1) !== "";
}

/**
 * Reconcile a run's leads against history. Deterministic: same (leads, history) ⇒
 * identical results (PRN-01). Every lead is returned in input order (DED-03).
 */
export function dedupeRun(
  leads: readonly DedupeInput[],
  history: ReadonlyMap<string, HistoryEntry>,
): DedupeResult[] {
  const seenThisRun = new Map<string, number>();
  const results: DedupeResult[] = [];

  leads.forEach((lead, i) => {
    const dedupable = isDedupable(lead.dedupeKey);

    // (1) Prior-run match (DED-01, PRN-05): revert to the original partner + method.
    const prior = dedupable ? history.get(lead.dedupeKey) : undefined;
    if (prior) {
      results.push({
        previouslyMatched: true,
        partnerId: prior.partnerId,
        matchMethod: prior.matchMethod,
        originalPartnerId: prior.partnerId,
        firstMatchedAt: prior.firstMatchedAt,
        phoneConfirmed: lead.phoneNorm !== "" && lead.phoneNorm === prior.phoneNorm,
        duplicateOfIndex: null,
      });
      return;
    }

    // (2) Within-run duplicate: collapse onto the first occurrence's assignment.
    const firstIdx = dedupable ? seenThisRun.get(lead.dedupeKey) : undefined;
    if (firstIdx !== undefined) {
      const first = results[firstIdx];
      results.push({
        previouslyMatched: true,
        partnerId: first.partnerId,
        matchMethod: first.matchMethod,
        originalPartnerId: first.partnerId,
        firstMatchedAt: first.firstMatchedAt,
        phoneConfirmed: lead.phoneNorm !== "" && lead.phoneNorm === leads[firstIdx].phoneNorm,
        duplicateOfIndex: firstIdx,
      });
      return;
    }

    // (3) New lead: keep the current assignment; the caller stamps first_matched_at.
    if (dedupable) seenThisRun.set(lead.dedupeKey, i);
    results.push({
      previouslyMatched: false,
      partnerId: lead.partnerId,
      matchMethod: lead.matchMethod,
      originalPartnerId: null,
      firstMatchedAt: null,
      phoneConfirmed: false,
      duplicateOfIndex: null,
    });
  });

  return results;
}
