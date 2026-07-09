import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyProfile } from "../src/modules/sources/index";
import { INVESTORFUSE_PROFILE } from "../src/modules/sources/seed-profiles";
import {
  normalizeZip,
  normalizeState,
  normalizePhone,
  computeDedupeKey,
} from "../src/modules/pipeline/normalize";
import { evaluate } from "../src/modules/pipeline/mls";
import { DEFAULT_MLS_PATTERNS } from "../src/modules/pipeline/mls-patterns";
import { assign, buildCoverage } from "../src/modules/pipeline/assign";
import { dedupeRun, type DedupeInput } from "../src/modules/pipeline/dedupe";
import { computeRunSummary, type RunSummaryLead } from "../src/modules/analytics/run-summary";
import { renderExport, type ExportLead, type PartnerInfo } from "../src/modules/export/render";
import { PARTNER_PALETTE } from "../src/lib/tokens/tokens";
import { SAMPLE_STATE_RULES, SAMPLE_ZIP_COVERAGE } from "../tests/fixtures/sample-coverage";

// Dev-only PREVIEW composer (NOT the production run path — that's WP-017). Runs the pure
// pipeline over the anonymized real week using SAMPLE coverage so it distributes, and renders
// the colored .xlsx so the owner can eyeball the deliverable. Real coverage is deferred.

const partners = new Map<string, PartnerInfo>(
  PARTNER_PALETTE.map((p, i) => [
    p.name,
    { id: p.name, name: p.name, refId: `JV-${String(i + 1).padStart(3, "0")}`, color: p.hex },
  ]),
);
const coverage = buildCoverage(SAMPLE_ZIP_COVERAGE, SAMPLE_STATE_RULES);

const rows = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "investorfuse-week-anon.json"), "utf8"),
) as Record<string, string>[];

const processed = rows.map((row) => {
  const { canonical } = applyProfile(row, INVESTORFUSE_PROFILE);
  const a = assign(normalizeZip(canonical.zip), normalizeState(canonical.state), coverage);
  return {
    canonical,
    mls: evaluate(canonical.notes, DEFAULT_MLS_PATTERNS).verdict,
    dedupeInput: {
      dedupeKey: computeDedupeKey(canonical.address, canonical.zip),
      phoneNorm: normalizePhone(canonical.phone),
      partnerId: a.partnerId,
      matchMethod: a.matchMethod,
    } satisfies DedupeInput,
  };
});

const deduped = dedupeRun(
  processed.map((p) => p.dedupeInput),
  new Map(),
);

const summary = computeRunSummary(
  processed.map(
    (p, i): RunSummaryLead => ({
      mlsStatus: p.mls,
      matchMethod: deduped[i].matchMethod,
      partnerId: deduped[i].partnerId,
      previouslyMatched: deduped[i].previouslyMatched,
    }),
  ),
);

// The partner deliverable sheet excludes MLS-removed leads (summarised only).
const exportLeads: ExportLead[] = processed
  .map((p, i) => ({ p, d: deduped[i], i }))
  .filter(({ p }) => p.mls === "kept")
  .map(({ p, d, i }) => ({
    leadRefId: `LD-2026-${String(i + 1).padStart(5, "0")}`,
    campaign: p.canonical.campaign ?? "",
    dateCreated: p.canonical.dateCreated ?? "",
    notes: p.canonical.notes ?? "",
    address: p.canonical.address ?? "",
    city: p.canonical.city ?? "",
    state: p.canonical.state ?? "",
    zip: p.canonical.zip ?? "",
    sellerFirst: p.canonical.sellerFirst ?? "",
    sellerLast: p.canonical.sellerLast ?? "",
    phone: p.canonical.phone ?? "",
    email: p.canonical.email ?? "",
    reasonForSelling: p.canonical.reasonForSelling ?? "",
    motivation: p.canonical.motivation ?? "",
    timeToSell: p.canonical.timeToSell ?? "",
    partnerId: d.partnerId,
    previouslyMatched: d.previouslyMatched,
    possibleMlsListing: "pending" as const,
  }));

const out = process.argv[2] ?? join(process.cwd(), "sample-week-export.xlsx");
renderExport(exportLeads, partners, summary, { colorCoding: true }).then((bytes) => {
  writeFileSync(out, bytes);
  console.log(`Wrote ${out}`);
  console.log(
    `  total ${summary.total} · kept ${summary.kept} · removed ${summary.removed} · unmatched ${summary.unmatched} · prev-matched ${summary.previouslyMatched}`,
  );
  console.log(`  per-partner: ${summary.perPartner.map((p) => `${p.partnerId}=${p.count}`).join(", ")}`);
});
