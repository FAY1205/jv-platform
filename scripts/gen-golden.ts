import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planRun } from "../src/modules/run/plan";
import { buildRulesSnapshot } from "../src/modules/run/snapshot";
import { buildCoverage } from "../src/modules/pipeline/assign";
import { DEFAULT_MLS_PATTERNS } from "../src/modules/pipeline/mls-patterns";
import { INVESTORFUSE_PROFILE } from "../src/modules/sources/seed-profiles";
import { SAMPLE_STATE_RULES, SAMPLE_ZIP_COVERAGE } from "../tests/fixtures/sample-coverage";

// Regenerate the TST-05 golden (WP-022): the pinned per-lead outcome of the whole PURE
// pipeline over the anonymized week under a fixed rule set. The owner hand-verifies this
// against their manual output; the golden.test.ts then locks it so any drift fails CI.
// Run: npx tsx scripts/gen-golden.ts   (pure — no DB).

const RECODES = [
  { matchPattern: "Lead Zolo*", code: "Z" },
  { matchPattern: "Real Estate Bees", code: "B" },
];
// Fixed golden coverage: sample states (minus HI → one unmatched) + the two ZIP overrides.
const STATE_RULES = SAMPLE_STATE_RULES.filter((s) => s.state !== "HI").map((s) => ({ state: s.state, partnerId: s.partnerId }));
const ZIP_COVERAGE = SAMPLE_ZIP_COVERAGE.map((z) => ({ zip5: z.zip5, partnerId: z.partnerId }));

const rows = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "investorfuse-week-anon.json"), "utf8")) as Record<string, string>[];

const { leads } = planRun(
  rows,
  INVESTORFUSE_PROFILE,
  { mlsPatterns: DEFAULT_MLS_PATTERNS, recodes: RECODES, coverage: buildCoverage(ZIP_COVERAGE, STATE_RULES) },
  new Map(),
);

const { hash } = buildRulesSnapshot({
  sourceProfile: { id: INVESTORFUSE_PROFILE.id, version: INVESTORFUSE_PROFILE.version },
  mlsPatterns: DEFAULT_MLS_PATTERNS,
  recodes: RECODES,
  stateRules: STATE_RULES,
  zipCoverage: ZIP_COVERAGE,
});

// Semantic projection: only the decision-bearing fields, sorted deterministically.
const outcomes = leads
  .map((l) => ({
    key: l.dedupeKey,
    campaign: l.campaignCode,
    mls: l.mlsStatus,
    match: l.matchMethod,
    partner: l.partnerId,
    prev: l.previouslyMatched,
  }))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

const golden = { rulesHash: hash, outcomes };
const out = join(process.cwd(), "tests", "fixtures", "investorfuse-week-golden.json");
writeFileSync(out, JSON.stringify(golden, null, 2) + "\n");
console.log(`Wrote ${out}: ${outcomes.length} leads, rulesHash ${hash.slice(0, 12)}…`);
