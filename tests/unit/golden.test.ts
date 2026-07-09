import { describe, expect, it } from "vitest";
import { planRun } from "@/modules/run/plan";
import { buildRulesSnapshot } from "@/modules/run/snapshot";
import { buildCoverage } from "@/modules/pipeline/assign";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import { INVESTORFUSE_PROFILE } from "@/modules/sources";
import { SAMPLE_STATE_RULES, SAMPLE_ZIP_COVERAGE } from "../fixtures/sample-coverage";
import anonRows from "../fixtures/investorfuse-week-anon.json";
import golden from "../fixtures/investorfuse-week-golden.json";

// ─────────────────────────────────────────────────────────────────────────────
// TST-05 golden gate. The whole PURE pipeline over the anonymized real week under a
// FIXED rule set must reproduce the pinned, hand-verified outcome exactly — a semantic
// zero-diff on the decision-bearing fields (MLS verdict, assignment, campaign code,
// previously-matched). Any code change that shifts an outcome fails here; the owner then
// either confirms the change (regenerate via scripts/gen-golden.ts) or fixes the bug.
// The golden coverage is pinned in the fixture; regenerate deliberately, never casually.
// ─────────────────────────────────────────────────────────────────────────────

const RECODES = [
  { matchPattern: "Lead Zolo*", code: "Z" },
  { matchPattern: "Real Estate Bees", code: "B" },
];
const STATE_RULES = SAMPLE_STATE_RULES.filter((s) => s.state !== "HI").map((s) => ({ state: s.state, partnerId: s.partnerId }));
const ZIP_COVERAGE = SAMPLE_ZIP_COVERAGE.map((z) => ({ zip5: z.zip5, partnerId: z.partnerId }));

const { leads } = planRun(
  anonRows as Record<string, unknown>[],
  INVESTORFUSE_PROFILE,
  { mlsPatterns: DEFAULT_MLS_PATTERNS, recodes: RECODES, coverage: buildCoverage(ZIP_COVERAGE, STATE_RULES) },
  new Map(),
);

const actual = leads
  .map((l) => ({ key: l.dedupeKey, campaign: l.campaignCode, mls: l.mlsStatus, match: l.matchMethod, partner: l.partnerId, prev: l.previouslyMatched, patternKey: l.mlsPatternKey, span: l.mlsMatchSpan }))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

describe("TST-05: golden semantic zero-diff (real anonymized week)", () => {
  it("TST-05: the pipeline reproduces the pinned week outcome exactly", () => {
    expect(actual).toEqual(golden.outcomes);
  });

  it("DM-08: the rules snapshot hash is pinned to the golden", () => {
    const { hash } = buildRulesSnapshot({
      sourceProfile: { id: INVESTORFUSE_PROFILE.id, version: INVESTORFUSE_PROFILE.version },
      mlsPatterns: DEFAULT_MLS_PATTERNS,
      recodes: RECODES,
      stateRules: STATE_RULES,
      zipCoverage: ZIP_COVERAGE,
    });
    expect(hash).toBe(golden.rulesHash);
  });

  it("covers the outcome mix a real week has (kept/removed, zip/state/unmatched)", () => {
    expect(golden.outcomes).toHaveLength((anonRows as unknown[]).length);
    expect(golden.outcomes.some((o) => o.mls === "removed")).toBe(true);
    expect(golden.outcomes.some((o) => o.match === "zip")).toBe(true); // a ZIP override fired
    expect(golden.outcomes.some((o) => o.match === "none")).toBe(true); // an unmatched coverage gap
  });
});
