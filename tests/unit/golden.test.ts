import { describe, expect, it } from "vitest";
import { planRun } from "@/modules/run/plan";
import { buildRulesSnapshot } from "@/modules/run/snapshot";
import { buildCoverage } from "@/modules/pipeline/assign";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import { LEAD_SOURCE_1_PROFILE } from "@/modules/sources";
import { SAMPLE_STATE_RULES, SAMPLE_ZIP_COVERAGE } from "../fixtures/sample-coverage";
import { LEAD_SOURCE_1_WEEK_ROWS } from "../fixtures/lead-source-1-week";
import golden from "../fixtures/lead-source-1-week-golden.json";

// ─────────────────────────────────────────────────────────────────────────────
// TST-05 golden gate. The whole PURE pipeline over a sanitized "Lead Source 1" week
// under a FIXED rule set must reproduce the pinned, hand-verified outcome exactly — a
// semantic zero-diff on the decision-bearing fields (MLS verdict, assignment, campaign).
// Any code change that shifts an outcome fails here; the owner then
// either confirms the change (regenerate via scripts/gen-golden.ts) or fixes the bug.
// Regenerate deliberately, never casually.
//
// WP-LS1: this replaces the retired InvestorFuse golden (owner decision 2026-07-15) —
// that format is no longer ingestable, so pinning it proved nothing about live behaviour.
// ─────────────────────────────────────────────────────────────────────────────

const STATE_RULES = SAMPLE_STATE_RULES.map((s) => ({ state: s.state, partnerId: s.partnerId }));
const ZIP_COVERAGE = SAMPLE_ZIP_COVERAGE.map((z) => ({ zip5: z.zip5, partnerId: z.partnerId }));

const { leads } = planRun(
  LEAD_SOURCE_1_WEEK_ROWS as Record<string, unknown>[],
  LEAD_SOURCE_1_PROFILE,
  { mlsPatterns: DEFAULT_MLS_PATTERNS, coverage: buildCoverage(ZIP_COVERAGE, STATE_RULES) },
);

// 2026-08-05 (audit R-33 + R-08): the tuple grew `matchedOn` + the score columns —
// all persisted decisions (DM-03) that were previously invisible to this gate — and
// the rulesHash was re-pinned because the snapshot now carries `scoringDigest`
// (DM-08 content pin). NOT a rules change: the underlying MLS patterns, coverage,
// profile, and scoring scheme are byte-identical to the previous pin.
const actual = leads
  .map((l) => ({ key: l.dedupeKey, campaign: l.campaign, mls: l.mlsStatus, match: l.matchMethod, partner: l.partnerId, patternKey: l.mlsPatternKey, span: l.mlsMatchSpan, matchedOn: l.matchedOn, score: l.scoreTotal, group: l.scoreGroup, scoreStatus: l.scoreStatus }))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

describe("TST-05: golden semantic zero-diff (sanitized Lead Source 1 week)", () => {
  it("TST-05: the pipeline reproduces the pinned week outcome exactly", () => {
    expect(actual).toEqual(golden.outcomes);
  });

  it("DM-08: the rules snapshot hash is pinned to the golden", () => {
    const { hash } = buildRulesSnapshot({
      sourceProfile: { id: LEAD_SOURCE_1_PROFILE.id, version: LEAD_SOURCE_1_PROFILE.version },
      mlsPatterns: DEFAULT_MLS_PATTERNS,
      stateRules: STATE_RULES,
      zipCoverage: ZIP_COVERAGE,
    });
    expect(hash).toBe(golden.rulesHash);
  });

  it("covers the outcome mix a real week has (kept/removed, zip/state/unmatched)", () => {
    expect(golden.outcomes).toHaveLength(LEAD_SOURCE_1_WEEK_ROWS.length);
    expect(golden.outcomes.some((o) => o.mls === "removed")).toBe(true);
    expect(golden.outcomes.some((o) => o.match === "zip")).toBe(true); // a ZIP override fired
    expect(golden.outcomes.some((o) => o.match === "state_fallback")).toBe(true);
    expect(golden.outcomes.some((o) => o.match === "none")).toBe(true); // an unmatched coverage gap
  });

  it("MLS-05: every removed lead carries the listing line that removed it", () => {
    // A partner-facing promise: a removed lead can always be shown WHY, highlighted.
    for (const o of golden.outcomes.filter((o) => o.mls === "removed")) {
      expect(o.patternKey).toBeTruthy();
      expect(o.span).not.toBeNull();
    }
  });

  it("SEC-05: no skip-trace data reaches a partner-visible field", () => {
    for (const lead of leads) {
      expect(lead.notes).not.toContain("Skip Trace");
      expect(lead.notes).not.toContain("[DNC]");
      expect(lead.notes).not.toContain("example.invalid;"); // the skip-trace value list
    }
  });
});
