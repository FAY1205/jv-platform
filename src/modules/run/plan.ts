import { applyProfile, findRowErrors, type SourceProfile } from "../sources/index";
import {
  normalizeZip,
  normalizeState,
  normalizePhone,
  computeDedupeKey,
} from "../pipeline/normalize";
import { evaluate, type MlsPattern } from "../pipeline/mls";
import { assign, type Coverage, type MatchMethod } from "../pipeline/assign";
import { dedupeRun, type HistoryEntry } from "../pipeline/dedupe";
import { computeRunSummary, type RunSummary } from "../analytics/run-summary";

// ─────────────────────────────────────────────────────────────────────────────
// Run plan (WP-017). PURE — composes the tested engines (apply → normalize → MLS →
// recode → assign → dedupe) plus the summary into the full set of lead decisions
// for one run. No I/O, no Date.now() (PRN-01): new leads carry firstMatchedAt=null
// for the impure orchestrator to stamp; ref-ids are allocated at persist time.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunRules {
  mlsPatterns: readonly MlsPattern[];
  coverage: Coverage;
}

export interface PlannedLead {
  /** Full source row, preserved forever (DM-02). */
  rawJson: Record<string, unknown>;
  // Canonical display values (ING-03). The as-imported campaign is the sole campaign
  // value (ADR-0018: recodes removed).
  campaign: string;
  dateCreated: string;
  notes: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  sellerFirst: string;
  sellerLast: string;
  phone: string;
  email: string;
  reasonForSelling: string;
  motivation: string;
  timeToSell: string;
  // Normalized keys.
  dedupeKey: string;
  zip5: string;
  stateCode: string;
  phoneNorm: string;
  // Decisions (DM-03).
  mlsStatus: "kept" | "removed";
  mlsReason: string;
  mlsPatternKey: string | null;
  mlsMatchSpan: { start: number; end: number; text: string } | null;
  partnerId: string | null;
  matchMethod: MatchMethod;
  matchedOn: string | null;
  previouslyMatched: boolean;
  originalPartnerId: string | null;
  firstMatchedAt: string | null;
  phoneConfirmed: boolean;
  possibleMlsListing: "pending";
  rowErrors: string[];
}

export interface RunPlan {
  leads: PlannedLead[];
  summary: RunSummary;
}

export function planRun(
  rows: readonly Record<string, unknown>[],
  profile: SourceProfile,
  rules: RunRules,
  history: ReadonlyMap<string, HistoryEntry>,
): RunPlan {
  const pre = rows.map((row) => {
    const applied = applyProfile(row, profile);
    const c = applied.canonical;
    return {
      applied,
      c,
      zip5: normalizeZip(c.zip),
      stateCode: normalizeState(c.state),
      phoneNorm: normalizePhone(c.phone),
      dedupeKey: computeDedupeKey(c.address, c.zip),
      mls: evaluate(c.notes, rules.mlsPatterns),
    };
  });

  const assignments = pre.map((p) => assign(p.zip5, p.stateCode, rules.coverage));
  const deduped = dedupeRun(
    pre.map((p, i) => ({
      dedupeKey: p.dedupeKey,
      phoneNorm: p.phoneNorm,
      partnerId: assignments[i].partnerId,
      matchMethod: assignments[i].matchMethod,
    })),
    history,
  );

  const leads: PlannedLead[] = pre.map((p, i) => {
    const d = deduped[i];
    return {
      rawJson: p.applied.raw,
      campaign: p.c.campaign ?? "",
      dateCreated: p.c.dateCreated ?? "",
      notes: p.c.notes ?? "",
      address: p.c.address ?? "",
      city: p.c.city ?? "",
      state: p.c.state ?? "",
      zip: p.c.zip ?? "",
      sellerFirst: p.c.sellerFirst ?? "",
      sellerLast: p.c.sellerLast ?? "",
      phone: p.c.phone ?? "",
      email: p.c.email ?? "",
      reasonForSelling: p.c.reasonForSelling ?? "",
      motivation: p.c.motivation ?? "",
      timeToSell: p.c.timeToSell ?? "",
      dedupeKey: p.dedupeKey,
      zip5: p.zip5,
      stateCode: p.stateCode,
      phoneNorm: p.phoneNorm,
      mlsStatus: p.mls.verdict,
      mlsReason: p.mls.reason,
      mlsPatternKey: p.mls.pattern?.id ?? null,
      mlsMatchSpan: p.mls.match ?? null,
      partnerId: d.partnerId,
      matchMethod: d.matchMethod,
      // For a previously-matched lead the partner came from history, not this run's
      // coverage, so there is no current matchedOn key.
      matchedOn: d.previouslyMatched ? null : assignments[i].matchedOn,
      previouslyMatched: d.previouslyMatched,
      originalPartnerId: d.originalPartnerId,
      firstMatchedAt: d.firstMatchedAt,
      phoneConfirmed: d.phoneConfirmed,
      possibleMlsListing: "pending",
      rowErrors: findRowErrors(p.applied),
    };
  });

  const summary = computeRunSummary(
    leads.map((l) => ({
      mlsStatus: l.mlsStatus,
      matchMethod: l.matchMethod,
      partnerId: l.partnerId,
      previouslyMatched: l.previouslyMatched,
    })),
  );

  return { leads, summary };
}
