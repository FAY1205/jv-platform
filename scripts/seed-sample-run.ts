import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { DrizzleRunStore } from "../src/modules/run/store";
import { processRun } from "../src/modules/run/process";
import { buildCoverage } from "../src/modules/pipeline/assign";
import { DEFAULT_MLS_PATTERNS } from "../src/modules/pipeline/mls-patterns";
import { INVESTORFUSE_PROFILE } from "../src/modules/sources/seed-profiles";
import { SAMPLE_STATE_RULES, SAMPLE_ZIP_COVERAGE } from "../tests/fixtures/sample-coverage";

// Dev-only: persist ONE distributed run of the anonymized week into the dev tenant so
// the run views have data. Clears prior demo runs first so it always yields a clean
// IM-26-001. Coverage is SAMPLE data (leaves HI uncovered to show an unmatched lead).

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set — run with node --env-file=.env.local");
const client = postgres(url, { prepare: false, max: 1 });
const db = drizzle(client, { schema });

async function main() {
  const [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, "dev-jv"));
  if (!tenant) throw new Error('dev tenant "dev-jv" not found — run pnpm db:seed first');
  const tenantId = tenant.id;

  // Clean prior demo runs (dev-jv only) so the seed is repeatable.
  await db.delete(schema.leads).where(eq(schema.leads.tenantId, tenantId));
  await db.delete(schema.uploads).where(eq(schema.uploads.tenantId, tenantId));
  await db.delete(schema.refCounters).where(and(eq(schema.refCounters.tenantId, tenantId), inArray(schema.refCounters.entity, ["lead", "upload"])));

  const partners = await db.select({ id: schema.partners.id, name: schema.partners.name }).from(schema.partners).where(eq(schema.partners.tenantId, tenantId));
  const nameToId = new Map(partners.map((p) => [p.name, p.id]));

  const stateRules = SAMPLE_STATE_RULES.filter((s) => s.state !== "HI") // leave HI uncovered → an unmatched example
    .map((s) => ({ state: s.state, partnerId: nameToId.get(s.partnerId) }))
    .filter((s): s is { state: string; partnerId: string } => Boolean(s.partnerId));
  const zipCoverage = SAMPLE_ZIP_COVERAGE.map((z) => ({ zip5: z.zip5, partnerId: nameToId.get(z.partnerId) })).filter(
    (z): z is { zip5: string; partnerId: string } => Boolean(z.partnerId),
  );

  const rows = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "investorfuse-week-anon.json"), "utf8")) as Record<string, string>[];

  const store = new DrizzleRunStore(db);
  const result = await processRun(
    {
      tenantId,
      filename: "investorfuse-week-anon.xlsx",
      rows,
      profile: INVESTORFUSE_PROFILE,
      rules: { mlsPatterns: DEFAULT_MLS_PATTERNS, coverage: buildCoverage(zipCoverage, stateRules) },
      snapshotInput: {
        sourceProfile: { id: INVESTORFUSE_PROFILE.id, version: INVESTORFUSE_PROFILE.version },
        mlsPatterns: DEFAULT_MLS_PATTERNS,
        stateRules,
        zipCoverage,
      },
      year: 2026,
      colorCoding: true,
    },
    { store, clock: () => "2026-07-08T12:00:00.000Z" },
  );

  console.log(`Persisted ${result.uploadRefId}: ${JSON.stringify(result.summary)}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
