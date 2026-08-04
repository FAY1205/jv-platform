// ─────────────────────────────────────────────────────────────────────────────
// Lead scoring (SCR-01..10, PRN-01). PURE — no I/O, no Date.now(). Same input ⇒
// same output. Implements the RESIDI scoring workbook: five criteria worth up to
// 10 points each (max 50), an automatic penalty, and three groups. A lead scores
// only when every required input is present; otherwise it is "incomplete" and
// carries no number (an incomplete lead never becomes Hot, so it never alerts).
//
// The point tables are FIXED in code for v1 (owner decision) and pinned by
// SCORING_VERSION, which a run records in its rules snapshot (DM-08). File contents
// (notes) are DATA — read, never evaluated as instructions (PRN-10).
// ─────────────────────────────────────────────────────────────────────────────

export const SCORING_VERSION = "residi-v1";

/** Group thresholds (inclusive lower bounds). Hot ≥ 38, Warm 25–37, Nurture 0–24. */
export const HOT_THRESHOLD = 38;
export const WARM_THRESHOLD = 25;
/** Points removed when an over-leveraged property also carries a government loan. */
export const OVERLEVERAGED_PENALTY = -15;

export type ScoreGroup = "hot" | "warm" | "nurture";
export type ScoreStatus = "complete" | "incomplete";

/** Highest attainable score (5 criteria × 10). */
export const MAX_SCORE = 50;

// ── Human-readable scheme descriptor (the Rules page renders THIS) ──
// Single source of truth for what the app documents. A test (score.test.ts) pins each
// tier's points to what scoreLead() actually computes, so the page can never drift
// from the engine.

export interface SchemeTier {
  /** The allowed values this tier covers, phrased for a reader. */
  values: string;
  points: number;
}
export interface SchemeCriterion {
  key: "state" | "motivation" | "timeline" | "equity" | "mortgage";
  name: string;
  /** When this criterion is required for a complete score. */
  required: string;
  tiers: SchemeTier[];
}
export interface SchemeGroup {
  key: ScoreGroup;
  label: string;
  min: number;
  max: number;
  alerts: boolean;
}

export const SCORING_SCHEME: {
  maxTotal: number;
  criteria: SchemeCriterion[];
  penalty: { points: number; when: string };
  groups: SchemeGroup[];
} = {
  maxTotal: MAX_SCORE,
  criteria: [
    {
      key: "state",
      name: "State",
      required: "Yes",
      tiers: [
        { values: "AZ · CA · TX · FL · CO", points: 10 },
        { values: "HI · NV · GA · NJ · DC", points: 7 },
        { values: "All other states", points: 5 },
      ],
    },
    {
      key: "motivation",
      name: "Motivation",
      required: "Yes",
      tiers: [
        { values: "Inheritance · financial hardship · emergency · foreclosure or pre-foreclosure · needs money for another investment", points: 10 },
        { values: "Any other stated reason (relocating, downsizing, upgrading, other)", points: 7 },
      ],
    },
    {
      key: "timeline",
      name: "Timeline",
      required: "Yes",
      tiers: [
        { values: "ASAP · urgent · within 30 days · within 1–3 months", points: 10 },
        { values: "3–6 months", points: 7 },
        { values: "6+ months · no hurry", points: 3 },
      ],
    },
    {
      key: "equity",
      name: "Equity",
      required: "Yes",
      tiers: [
        { values: "Owned free and clear", points: 10 },
        { values: "Loan under 20% of property value", points: 8 },
        { values: "Loan at 20–70% of value", points: 5 },
        { values: "Loan at 70% of value or more", points: 3 },
      ],
    },
    {
      key: "mortgage",
      name: "Mortgage",
      required: "Unless free and clear",
      tiers: [
        { values: "No mortgage · new conventional loan", points: 10 },
        { values: "HELOC · construction loan", points: 5 },
        { values: "USDA / VA / FHA loan", points: 3 },
        { values: "Other, or loan type unknown", points: 0 },
      ],
    },
  ],
  penalty: {
    points: -15,
    when: "Loan at 80%+ of value and a USDA/VA/FHA loan — hard to buy out",
  },
  groups: [
    { key: "nurture", label: "Nurture", min: 0, max: 24, alerts: false },
    { key: "warm", label: "Warm", min: 25, max: 37, alerts: false },
    { key: "hot", label: "Hot", min: 38, max: 50, alerts: true },
  ],
};

/** Equity signal. Numeric loan-to-value (debt ÷ estimated value) or a direct flag. */
export type EquitySignal =
  | { kind: "free_and_clear" }
  | { kind: "ltv"; ratio: number }
  | { kind: "none" };

export interface ScoringInput {
  /** 2-letter state (already normalized upstream). */
  state: string;
  /** The seller's stated reason for selling — the workbook's "Motivation". */
  motivation: string;
  /** How soon they want to sell — the workbook's "Timeline". */
  timeline: string;
  equity: EquitySignal;
  /** Raw loan-type text; "" when unknown. */
  loanType: string;
}

/** One criterion's contribution. `points` is null when the input was missing. */
export interface CriterionScore {
  points: number | null;
  /** Short human label for the lead dialog, e.g. "Immediate" or "Loan 20–70% of value". */
  label: string;
}

export interface ScoreBreakdown {
  state: CriterionScore;
  motivation: CriterionScore;
  timeline: CriterionScore;
  equity: CriterionScore;
  mortgage: CriterionScore;
  /** 0 or OVERLEVERAGED_PENALTY. */
  penalty: number;
}

export interface ScoreResult {
  status: ScoreStatus;
  /** Total out of 50; null when incomplete. */
  total: number | null;
  group: ScoreGroup | null;
  breakdown: ScoreBreakdown;
  /** Which required inputs were missing/unrecognized (for the "incomplete" reason). */
  missing: string[];
}

// ── Recode tables (the workbook's allowed values → points) ──

const STATE_PRIORITY = new Set(["AZ", "CA", "TX", "FL", "CO"]);
const STATE_SECONDARY = new Set(["HI", "NV", "GA", "NJ", "DC"]);

/** Keyword tests are lowercase substring/boundary matches so real vendor phrasings
 *  ("Income loss / Financial hardship", "Foreclosure / Pre-foreclosure") map cleanly. */
const MOTIVATION_HIGH = [
  "inheritance",
  "inherited",
  "financial hardship",
  "income loss",
  "emergency",
  "foreclosure",
  "pre-foreclosure",
  "needs money for another investment",
];

const TIMELINE_IMMEDIATE = ["asap", "urgent", "within 30", "within 1-3", "within 3 month", "immediately"];
const TIMELINE_MID = ["3-6", "3 - 6"];
const TIMELINE_DISTANT = ["6 month", "6-12", "no hurry", "not in a hurry", "no rush"];

function recodeState(state: string): CriterionScore {
  const s = state.trim().toUpperCase();
  if (!s) return { points: null, label: "No state" };
  if (STATE_PRIORITY.has(s)) return { points: 10, label: "Priority state" };
  if (STATE_SECONDARY.has(s)) return { points: 7, label: "Secondary state" };
  return { points: 5, label: "Standard state" };
}

function recodeMotivation(motivation: string): CriterionScore {
  const m = motivation.trim().toLowerCase();
  if (!m) return { points: null, label: "No reason given" };
  if (MOTIVATION_HIGH.some((k) => m.includes(k))) return { points: 10, label: "High motivation" };
  // Owner decision: any other stated reason is "Other" (7), never a blocker.
  return { points: 7, label: "Standard motivation" };
}

function recodeTimeline(timeline: string): CriterionScore {
  const t = timeline.trim().toLowerCase();
  if (!t) return { points: null, label: "No timeline" };
  if (TIMELINE_IMMEDIATE.some((k) => t.includes(k))) return { points: 10, label: "Immediate" };
  if (TIMELINE_MID.some((k) => t.includes(k))) return { points: 7, label: "Within 3–6 months" };
  if (TIMELINE_DISTANT.some((k) => t.includes(k))) return { points: 3, label: "Not in a hurry" };
  // Owner decision: an unrecognized timeline is missing, not a guess.
  return { points: null, label: "Unrecognized timeline" };
}

function recodeEquity(equity: EquitySignal): CriterionScore {
  if (equity.kind === "free_and_clear") return { points: 10, label: "Free and clear" };
  if (equity.kind === "none") return { points: null, label: "No equity data" };
  const { ratio } = equity;
  if (ratio < 0.2) return { points: 8, label: "Loan under 20% of value" };
  if (ratio < 0.7) return { points: 5, label: "Loan 20–70% of value" };
  return { points: 3, label: "Loan 70%+ of value" };
}

/** True when a government-backed loan (its own penalty axis, SCR-06). */
const GOV_LOAN = /\b(usda|va|fha)\b/i;

function recodeMortgage(equity: EquitySignal, loanType: string): CriterionScore {
  // Workbook: the mortgage criterion does not apply to a free-and-clear home — it
  // automatically scores the full 10.
  if (equity.kind === "free_and_clear") return { points: 10, label: "No mortgage (free and clear)" };
  const lt = loanType.toLowerCase();
  // Priority order avoids "conventional" falsely matching the VA token.
  if (GOV_LOAN.test(loanType)) return { points: 3, label: "Government loan (USDA/VA/FHA)" };
  if (/heloc|construction/.test(lt)) return { points: 5, label: "HELOC / construction loan" };
  if (/no mortgage|new conventional/.test(lt)) return { points: 10, label: "No mortgage / new conventional" };
  // Owner decision: unknown or other loan types score 0 rather than blocking the lead.
  return { points: 0, label: lt ? "Other loan type" : "Loan type unknown" };
}

function groupFor(total: number): ScoreGroup {
  if (total >= HOT_THRESHOLD) return "hot";
  if (total >= WARM_THRESHOLD) return "warm";
  return "nurture";
}

/**
 * Score a lead from structured inputs. Deterministic (PRN-01). Missing any required
 * input yields an "incomplete" result with a null total — never a misleading number.
 */
export function scoreLead(input: ScoringInput): ScoreResult {
  const state = recodeState(input.state);
  const motivation = recodeMotivation(input.motivation);
  const timeline = recodeTimeline(input.timeline);
  const equity = recodeEquity(input.equity);
  const mortgage = recodeMortgage(input.equity, input.loanType);

  // Penalty (SCR-06): an 80%+ loan combined with a government loan is hard to buy out.
  const penalty =
    input.equity.kind === "ltv" && input.equity.ratio >= 0.8 && GOV_LOAN.test(input.loanType)
      ? OVERLEVERAGED_PENALTY
      : 0;

  const breakdown: ScoreBreakdown = { state, motivation, timeline, equity, mortgage, penalty };

  const criteria: [string, CriterionScore][] = [
    ["state", state],
    ["motivation", motivation],
    ["timeline", timeline],
    ["equity", equity],
    ["mortgage", mortgage],
  ];
  const missing = criteria.filter(([, c]) => c.points === null).map(([name]) => name);

  if (missing.length > 0) {
    return { status: "incomplete", total: null, group: null, breakdown, missing };
  }

  const total =
    state.points! + motivation.points! + timeline.points! + equity.points! + mortgage.points! + penalty;
  return { status: "complete", total, group: groupFor(total), breakdown, missing: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCR-10: extraction. Timeline and motivation are already canonical fields; equity
// and loan type are not — they live inside the notes blob in vendor-specific
// formats (LeadZolo, Real Estate Bees). This reader mirrors the anchored, per-line
// discipline of sources/transforms.notesField: [ \t] only (never \s, which would
// cross newlines and bind a label to another line's value, the PRN-04 hazard).
// ─────────────────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pull `Label: value` (or `Label? value` — vendors use "?" for yes/no fields) out
 * of a notes blob, trying each label in order. Returns the same-line value only.
 */
function notesLine(notes: string, labels: readonly string[]): string {
  for (const label of labels) {
    const re = new RegExp(String.raw`^[ \t]*\*?[ \t]*${escapeRe(label)}[ \t]*[:?]+[ \t]*(.*)$`, "im");
    const value = re.exec(notes)?.[1]?.trim();
    if (value) return value;
  }
  return "";
}

/** Strict money parse: digits with optional $, commas and decimals only. Blank or
 *  any non-numeric text (a stray label, "No", "N/A") ⇒ null, never a coerced 0. */
function parseMoney(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "");
  if (!/^[0-9][0-9,]*(\.[0-9]+)?$/.test(t)) return null;
  return Number(t.replace(/,/g, ""));
}

const YES = /^(1|y|yes|true)\b/i;

/** Derive the equity signal from a lead's notes (both vendor templates). */
function extractEquity(notes: string): EquitySignal {
  const freeClear = notesLine(notes, ["Free & Clear", "Free and Clear"]);
  const debt = parseMoney(notesLine(notes, ["Est. Mortgage Balance", "Current debt"]));
  const value = parseMoney(notesLine(notes, ["Estimated Value", "Market price estimate"]));
  if (YES.test(freeClear) || debt === 0) return { kind: "free_and_clear" };
  if (debt !== null && value !== null && value > 0) return { kind: "ltv", ratio: debt / value };
  return { kind: "none" };
}

/**
 * Assemble a full ScoringInput from a lead's canonical fields + notes. Pure. The
 * caller passes the canonical state (normalized), reason-for-selling (motivation),
 * and time-to-sell (timeline); equity and loan type are dug out of the notes.
 */
export function extractScoringInput(lead: {
  state: string;
  motivation: string;
  timeline: string;
  notes: string;
}): ScoringInput {
  return {
    state: lead.state,
    motivation: lead.motivation,
    timeline: lead.timeline,
    equity: extractEquity(lead.notes),
    loanType: notesLine(lead.notes, ["Loan type"]),
  };
}
