import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { SAMPLE_STATE_RULES, SAMPLE_ZIP_COVERAGE } from "../tests/fixtures/sample-coverage";

// Dev-only: load SAMPLE coverage (states of the anon week, minus HI, + 2 ZIP overrides) into
// the dev tenant so an uploaded national week distributes. Also clears prior demo runs so the
// first upload through the route yields a clean IM-26-001. NOT real territory data.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set — run with node --env-file=.env.local");
const client = postgres(url, { prepare: false, max: 1 });
const db = drizzle(client, { schema });

async function main() {
  const [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, "dev-jv"));
  if (!tenant) throw new Error('dev tenant "dev-jv" not found — run pnpm db:seed first');
  const tenantId = tenant.id;

  // Reset prior demo runs + coverage so this is repeatable.
  await db.delete(schema.leads).where(eq(schema.leads.tenantId, tenantId));
  await db.delete(schema.uploads).where(eq(schema.uploads.tenantId, tenantId));
  await db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.tenantId, tenantId));
  await db.delete(schema.coverageZips).where(eq(schema.coverageZips.tenantId, tenantId));
  await db.delete(schema.refCounters).where(and(eq(schema.refCounters.tenantId, tenantId), inArray(schema.refCounters.entity, ["lead", "upload"])));

  const partners = await db.select({ id: schema.partners.id, name: schema.partners.name }).from(schema.partners).where(eq(schema.partners.tenantId, tenantId));
  const nameToId = new Map(partners.map((p) => [p.name, p.id]));

  const stateRows = SAMPLE_STATE_RULES.filter((s) => s.state !== "HI")
    .map((s) => ({ tenantId, state: s.state, partnerId: nameToId.get(s.partnerId) }))
    .filter((s): s is { tenantId: string; state: string; partnerId: string } => Boolean(s.partnerId));
  await db.insert(schema.stateRules).values(stateRows).onConflictDoNothing({ target: [schema.stateRules.tenantId, schema.stateRules.state] });

  const zipRows = SAMPLE_ZIP_COVERAGE.map((z) => ({ tenantId, zip5: z.zip5, partnerId: nameToId.get(z.partnerId) })).filter(
    (z): z is { tenantId: string; zip5: string; partnerId: string } => Boolean(z.partnerId),
  );
  await db.insert(schema.coverageZips).values(zipRows);

  console.log(`Seeded ${stateRows.length} state rules + ${zipRows.length} zip overrides into dev-jv; cleared prior demo runs.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
