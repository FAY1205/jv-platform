import { applyProfile, findRowErrors, type SourceProfile } from "../sources/index";
import {
  normalizeZip,
  normalizeState,
  normalizePhone,
  computeDedupeKey,
} from "../pipeline/normalize";
import { evaluate, type MlsPattern } from "../pipeline/mls";
import { assign, type Coverage, type MatchMethod } from "../pipeline/assign";
import {
  scoreLead,
  extractScoringInput,
  type ScoreGroup,
  type ScoreStatus,
  type ScoreBreakdown,
} from "../pipeline/score";
import { computeRunSummary, type RunSummary } from "../analytics/run-summary";

// ─────────────────────────────────────────────────────────────────────────────
// Run plan (WP-017). PURE — composes the tested engines (apply → normalize → MLS →
// assign) plus the summary into the full set of lead decisions for one run. No I/O,
// no Date.now() (PRN-01): leads carry firstMatchedAt=null for the impure orchestrator
// to stamp; ref-ids are allocated at persist time. Dedup collapse was retired
// (ADR-0038: every row becomes a lead); the dedupe key is still computed and stored
// so same-house submissions stay groupable/reportable.
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
  firstMatchedAt: string | null;
  possibleMlsListing: "pending";
  // Scoring (SCR-01..10). Computed for every lead; the "hot" treatment (icon,
  // alert) is gated on mlsStatus === "kept" downstream, never here.
  scoreTotal: number | null;
  scoreGroup: ScoreGroup | null;
  scoreStatus: ScoreStatus;
  scoreBreakdown: ScoreBreakdown;
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

  const leads: PlannedLead[] = pre.map((p, i) => {
    // SCR-10: motivation = reason-for-selling, timeline = time-to-sell for this data;
    // equity + loan type are dug out of the (skip-trace-stripped) canonical notes.
    const score = scoreLead(
      extractScoringInput({
        state: p.stateCode,
        motivation: p.c.reasonForSelling ?? "",
        timeline: p.c.timeToSell ?? "",
        notes: p.c.notes ?? "",
      }),
    );
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
      partnerId: assignments[i].partnerId,
      matchMethod: assignments[i].matchMethod,
      matchedOn: assignments[i].matchedOn,
      firstMatchedAt: null,
      possibleMlsListing: "pending",
      scoreTotal: score.total,
      scoreGroup: score.group,
      scoreStatus: score.status,
      scoreBreakdown: score.breakdown,
      rowErrors: findRowErrors(p.applied),
    };
  });

  const summary = computeRunSummary(
    leads.map((l) => ({
      mlsStatus: l.mlsStatus,
      matchMethod: l.matchMethod,
      partnerId: l.partnerId,
    })),
  );

  return { leads, summary };
}
