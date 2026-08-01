import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
// Relative (not "@/") so this runs unchanged from the app, provisionSignup, the dev seed,
// AND any tsx provisioning script (tsx does not resolve "@/") — mirrors provision-signup.ts.
import * as schema from "./schema";
import { DEFAULT_MLS_PATTERNS } from "../modules/pipeline/mls-patterns";
import { SEED_SOURCE_PROFILES } from "../modules/sources/seed-profiles";

type DB = PostgresJsDatabase<typeof schema>;

// Default per-tenant Settings (SET catalog; PRN-11 — every setting has a default) and
// Feature flags (SEAM-09). Single source: both the dev seed and self-serve signup use these,
// so a hand-provisioned dev tenant and a signed-up tenant start identically (PRN-15).
export const DEFAULT_TENANT_SETTINGS: { key: string; value: unknown }[] = [
  { key: "color_coding", value: true }, // SET-01
  { key: "status_list", value: ["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead"] }, // SET-04 / SEAM-06
  { key: "listing_check", value: { linkOnly: true, automated: false } }, // SET-06
  { key: "retention_days", value: 365 }, // SET-07
  { key: "jv_notes_mapping", value: { mapped: false } }, // SET-05 / NTS-03
  { key: "ai_assistant", value: { enabled: false } }, // SET-11
];

export const DEFAULT_TENANT_FEATURE_FLAGS: { key: string; enabled: boolean }[] = [
  { key: "ai_assistant", enabled: false },
  { key: "captcha_auth", enabled: false },
];

/**
 * Seed the PARTNER-INDEPENDENT ingestion config every tenant needs to import and process
 * leads on day one: the Lead Source 1 source profile (with its `transform`, so PII-strip +
 * address/ZIP derivation run — WP-LS1), the MLS v2 patterns (so already-listed leads are
 * detected), and the Settings + Feature-flag defaults.
 *
 * Deliberately does NOT seed partners, coverage_zips, or state_rules: those are tenant-specific
 * admin setup, and state_rules carry a partner FK a brand-new tenant has none of. Assignment
 * therefore starts as "everything Unmatched" until the admin adds partners + coverage — which is
 * correct, not a bug.
 *
 * Accepts a DB handle OR a transaction (drizzle's tx satisfies `DB`), so signup runs it inside
 * the provisioning transaction — a tenant is never created without its ingestion config — and the
 * dev seed runs it standalone. Not idempotent on its own; callers guard (signup: fresh tenant in a
 * tx; dev seed: partner-count guard).
 */
export async function seedTenantRules(db: DB, tenantId: string): Promise<void> {
  await db.insert(schema.sourceProfiles).values(
    SEED_SOURCE_PROFILES.map((p) => ({
      tenantId,
      name: p.name,
      version: p.version,
      headerSignature: p.headerSignature,
      mapping: p.mapping,
      requiredColumns: p.requiredColumns,
      strictness: p.strictness,
      transform: p.transform ?? null,
    })),
  );
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
  await db.insert(schema.settings).values(
    DEFAULT_TENANT_SETTINGS.map((s) => ({ tenantId, key: s.key, value: s.value })),
  );
  await db.insert(schema.featureFlags).values(
    DEFAULT_TENANT_FEATURE_FLAGS.map((f) => ({ tenantId, key: f.key, enabled: f.enabled })),
  );
}
