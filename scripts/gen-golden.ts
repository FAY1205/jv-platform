import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { planRun } from "../src/modules/run/plan";
import { buildRulesSnapshot } from "../src/modules/run/snapshot";
import { buildCoverage } from "../src/modules/pipeline/assign";
import { DEFAULT_MLS_PATTERNS } from "../src/modules/pipeline/mls-patterns";
import { LEAD_SOURCE_1_PROFILE } from "../src/modules/sources/seed-profiles";
import { SAMPLE_STATE_RULES, SAMPLE_ZIP_COVERAGE } from "../tests/fixtures/sample-coverage";
import { LEAD_SOURCE_1_WEEK_ROWS } from "../tests/fixtures/lead-source-1-week";

// Regenerate the TST-05 golden (WP-022, re-pinned to Lead Source 1 by WP-LS1): the pinned
// per-lead outcome of the whole PURE pipeline over the sanitized week under a fixed rule
// set. The owner hand-verifies this; golden.test.ts then locks it so any drift fails CI.
// Run: npx tsx scripts/gen-golden.ts   (pure — no DB).

const STATE_RULES = SAMPLE_STATE_RULES.map((s) => ({ state: s.state, partnerId: s.partnerId }));
const ZIP_COVERAGE = SAMPLE_ZIP_COVERAGE.map((z) => ({ zip5: z.zip5, partnerId: z.partnerId }));

const { leads } = planRun(
  LEAD_SOURCE_1_WEEK_ROWS as Record<string, unknown>[],
  LEAD_SOURCE_1_PROFILE,
  { mlsPatterns: DEFAULT_MLS_PATTERNS, coverage: buildCoverage(ZIP_COVERAGE, STATE_RULES) },
);

const { hash } = buildRulesSnapshot({
  sourceProfile: { id: LEAD_SOURCE_1_PROFILE.id, version: LEAD_SOURCE_1_PROFILE.version },
  mlsPatterns: DEFAULT_MLS_PATTERNS,
  stateRules: STATE_RULES,
  zipCoverage: ZIP_COVERAGE,
});

// Semantic projection: only the decision-bearing fields, sorted deterministically.
const outcomes = leads
  .map((l) => ({
    key: l.dedupeKey,
    campaign: l.campaign,
    mls: l.mlsStatus,
    match: l.matchMethod,
    partner: l.partnerId,
    patternKey: l.mlsPatternKey,
    span: l.mlsMatchSpan,
  }))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

const golden = { rulesHash: hash, outcomes };
const out = join(process.cwd(), "tests", "fixtures", "lead-source-1-week-golden.json");
writeFileSync(out, JSON.stringify(golden, null, 2) + "\n");
console.log(`Wrote ${out}: ${outcomes.length} leads, rulesHash ${hash.slice(0, 12)}…`);
