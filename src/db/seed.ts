import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";
import { DEFAULT_MLS_PATTERNS } from "../modules/pipeline/mls-patterns";
import { GENERIC_PROFILE } from "../modules/sources/seed-profiles";
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
        refId: `JV-${String(i + 1).padStart(3, "0")}`,
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

    // MLS patterns (from the engine seed, WP-008).
    await db.insert(schema.mlsPatterns).values(
      DEFAULT_MLS_PATTERNS.map((p) => ({
        tenantId,
        patternKey: p.id,
        type: p.type,
        regex: p.regex,
        flags: p.flags ?? "i",
        label: p.label,
      })),
    );

    // Campaign recodes (EXP-01).
    await db.insert(schema.campaignRecodes).values([
      { tenantId, matchPattern: "Lead Zolo*", code: "Z" },
      { tenantId, matchPattern: "Real Estate Bees", code: "B" },
    ]);

    // Source profile (WP-010 seed).
    await db.insert(schema.sourceProfiles).values({
      tenantId,
      name: GENERIC_PROFILE.name,
      version: GENERIC_PROFILE.version,
      headerSignature: GENERIC_PROFILE.headerSignature,
      mapping: GENERIC_PROFILE.mapping,
      requiredColumns: GENERIC_PROFILE.requiredColumns,
      strictness: GENERIC_PROFILE.strictness,
    });

    // Settings defaults (SET catalog; PRN-11 — every setting has a default).
    await db.insert(schema.settings).values([
      { tenantId, key: "color_coding", value: true }, // SET-01
      {
        tenantId,
        key: "status_list", // SET-04 / SEAM-06
        value: ["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead"],
      },
      { tenantId, key: "listing_check", value: { linkOnly: true, automated: false } }, // SET-06
      { tenantId, key: "retention_days", value: 365 }, // SET-07
      { tenantId, key: "jv_notes_mapping", value: { mapped: false } }, // SET-05 / NTS-03
      { tenantId, key: "ai_assistant", value: { enabled: false } }, // SET-11
    ]);

    // Feature flags (SEAM-09).
    await db.insert(schema.featureFlags).values([
      { tenantId, key: "ai_assistant", enabled: false },
      { tenantId, key: "captcha_auth", enabled: false },
    ]);

    console.log(`Seeded dev tenant ${tenantId}: ${PARTNER_PALETTE.length} partners, ` +
      `${DEFAULT_MLS_PATTERNS.length} MLS patterns, ${STATE_RULES.length} state rules.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
