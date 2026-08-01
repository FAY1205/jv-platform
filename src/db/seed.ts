import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";
import { seedTenantRules } from "./seed-tenant-rules";
import { PARTNER_PALETTE } from "../lib/tokens/tokens";

// ─────────────────────────────────────────────────────────────────────────────
// Dev seed (SEC-07: fake data only). Rules-as-data seeds (patterns, recodes,
// statuses, source profiles, state rules, settings) come from the same modules
// the app uses — single source, no duplication (PRN-15). Idempotent: it no-ops
// if the dev tenant already has partners.
// ─────────────────────────────────────────────────────────────────────────────

const DEV_TENANT_SLUG = "dev-jv";

// State fallbacks (ASN-01 seed).
const STATE_RULES: [string, string][] = [
  ["SC", "Randy Wolfe"],
  ["VA", "Forrest McGhee"],
  ["NJ", "Josh Ax"],
  ["CT", "Josh Ax"],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — cannot seed.");
  const client = postgres(url, { prepare: false });
  const db = drizzle(client, { schema });

  try {
    // Ensure the dev tenant.
    await db
      .insert(schema.tenants)
      .values({ name: "JV Leads (dev)", slug: DEV_TENANT_SLUG })
      .onConflictDoNothing();
    const [tenant] = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, DEV_TENANT_SLUG));
    if (!tenant) throw new Error("failed to create dev tenant");
    const tenantId = tenant.id;

    // Idempotency guard.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.partners)
      .where(eq(schema.partners.tenantId, tenantId));
    if (count > 0) {
      console.log(`Seed skipped — dev tenant already has ${count} partners.`);
      return;
    }

    // Partners.
    await db.insert(schema.partners).values(
      PARTNER_PALETTE.map((p, i) => ({
        tenantId,
        refId: `PR-${String(i + 1).padStart(3, "0")}`,
        name: p.name,
        color: p.hex,
        status: "active" as const,
      })),
    );
    const partners = await db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.tenantId, tenantId));
    const byName = new Map(partners.map((p) => [p.name, p.id]));

    // State fallback rules (ASN-01).
    await db.insert(schema.stateRules).values(
      STATE_RULES.map(([state, name]) => ({
        tenantId,
        state,
        partnerId: byName.get(name)!,
      })),
    );

    // Partner-independent ingestion config: Lead Source 1 profile + MLS v2 patterns + setting/
    // feature defaults. Extracted to seed-tenant-rules.ts so self-serve signup seeds a tenant
    // byte-identically — single source, no duplication (PRN-15, WP-SU-21).
    await seedTenantRules(db, tenantId);

    console.log(`Seeded dev tenant ${tenantId}: ${PARTNER_PALETTE.length} partners, ` +
      `${STATE_RULES.length} state rules; ingestion config (source profile, MLS patterns, settings, flags) seeded.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
