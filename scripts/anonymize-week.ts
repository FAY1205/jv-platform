import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseWorkbook } from "../src/modules/sources/parse";
import { detectProfile, applyProfile } from "../src/modules/sources/index";
import { INVESTORFUSE_PROFILE, GENERIC_PROFILE } from "../src/modules/sources/seed-profiles";
import { evaluate } from "../src/modules/pipeline/mls";
import { DEFAULT_MLS_PATTERNS } from "../src/modules/pipeline/mls-patterns";
import { computeDedupeKey } from "../src/modules/pipeline/normalize";
import { anonymizeRow } from "./anonymize";

// ─────────────────────────────────────────────────────────────────────────────
// Dev-only runner (never shipped). Reads a real InvestorFuse .xlsx from the
// git-ignored .samples/ dir, verifies it detects as InvestorFuse v1, anonymizes it
// (SEC-05), and writes a committable PII-free fixture — the seed for the TST-05
// golden INPUT. Hand-verifying the expected OUTPUT is the owner's task (WP-022).
// Run:  (load .env not required)  npx tsx scripts/anonymize-week.ts
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLES_DIR = join(process.cwd(), ".samples");
const OUT = join(process.cwd(), "tests", "fixtures", "investorfuse-week-anon.json");

/** Guarantee the committable fixture leaks no email addresses (dates/prices won't match). */
function assertNoEmails(rows: Record<string, string>[]): void {
  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/;
  for (let i = 0; i < rows.length; i++) {
    for (const [k, v] of Object.entries(rows[i])) {
      if (email.test(v) && !/@example\.(test|com)/.test(v)) {
        throw new Error(`PII leak: email-like value in row ${i} column "${k}" — refusing to write.`);
      }
    }
  }
}

function main(): void {
  const files = readdirSync(SAMPLES_DIR)
    .filter((f) => f.toLowerCase().endsWith(".xlsx"))
    .sort();
  if (files.length === 0) throw new Error(`No .xlsx files found in ${SAMPLES_DIR}`);
  const target = files[files.length - 1];

  const bytes = readFileSync(join(SAMPLES_DIR, target));
  const { headers, rows } = parseWorkbook(bytes);

  const detected = detectProfile(headers, [INVESTORFUSE_PROFILE, GENERIC_PROFILE]);
  if (detected.status !== "exact" || detected.profile?.id !== "investorfuse") {
    throw new Error(
      `Expected exact InvestorFuse detection, got status=${detected.status} profile=${detected.profile?.id}`,
    );
  }

  // Stable synthetic id per distinct property (real dedupe_key) → dedupe survives anon.
  const idByKey = new Map<string, number>();
  const anon = rows.map((row) => {
    const { canonical } = applyProfile(row, INVESTORFUSE_PROFILE);
    const key = computeDedupeKey(canonical.address, canonical.zip);
    let n = idByKey.get(key);
    if (n === undefined) {
      n = idByKey.size + 1;
      idByKey.set(key, n);
    }
    return anonymizeRow(row, n);
  });

  assertNoEmails(anon);

  // Reality-check summary (no PII printed).
  let removed = 0;
  let kept = 0;
  let missingTerritory = 0;
  for (const r of anon) {
    const { canonical } = applyProfile(r, INVESTORFUSE_PROFILE);
    if (!canonical.zip && !canonical.state) missingTerritory++;
    if (evaluate(canonical.notes, DEFAULT_MLS_PATTERNS).verdict === "removed") removed++;
    else kept++;
  }

  writeFileSync(OUT, JSON.stringify(anon, null, 2) + "\n");
  console.log(`Anonymized ${anon.length} rows from "${target}" → ${OUT}`);
  console.log(
    `  distinct properties: ${idByKey.size} · MLS removed: ${removed} · kept: ${kept} · missing territory: ${missingTerritory}`,
  );
}

main();
