import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { seedTenantRules } from "@/db/seed-tenant-rules";

// WP-SU-21: a self-serve tenant must be seeded with the partner-independent ingestion config
// (Lead Source 1 profile + MLS v2 patterns + setting/feature defaults) so it can import leads on
// day one. Before this, only the dev-seed script seeded these, so a signed-up tenant had none.
// Self-skips without DATABASE_URL. Uses a BARE tenant (no audit_log row) so it is fully deletable.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("WP-SU-21: seedTenantRules", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;

  beforeAll(() => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function withBareTenant(fn: (tenantId: string) => Promise<void>) {
    const tenantId = randomUUID();
    await db.insert(schema.tenants).values({ id: tenantId, name: "Seed Rules Test", slug: `seed-test-${randomUUID().slice(0, 8)}` });
    try {
      await fn(tenantId);
    } finally {
      await db.delete(schema.sourceProfiles).where(eq(schema.sourceProfiles.tenantId, tenantId));
      await db.delete(schema.mlsPatterns).where(eq(schema.mlsPatterns.tenantId, tenantId));
      await db.delete(schema.settings).where(eq(schema.settings.tenantId, tenantId));
      await db.delete(schema.featureFlags).where(eq(schema.featureFlags.tenantId, tenantId));
      await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    }
  }

  it("WP-SU-21/SCP-02: seeds the Lead Source 1 profile (with transform), MLS patterns, and settings so a tenant can import immediately", async () => {
    await withBareTenant(async (tenantId) => {
      await seedTenantRules(db, tenantId);
      const profiles = await db.select().from(schema.sourceProfiles).where(eq(schema.sourceProfiles.tenantId, tenantId));
      const patterns = await db.select().from(schema.mlsPatterns).where(eq(schema.mlsPatterns.tenantId, tenantId));
      const settings = await db.select().from(schema.settings).where(eq(schema.settings.tenantId, tenantId));
      const flags = await db.select().from(schema.featureFlags).where(eq(schema.featureFlags.tenantId, tenantId));
      // The transform MUST be persisted, or skip-trace stripping + address/ZIP derivation silently
      // don't run and skip-trace data would ride into partner-visible notes (WP-LS1).
      expect(profiles.some((p) => p.name === "Lead Source 1" && p.transform === "lead-source-1")).toBe(true);
      expect(patterns.length).toBeGreaterThanOrEqual(1); // MLS v2 disqualifiers → already-listed leads detected
      expect(settings.length).toBeGreaterThanOrEqual(1);
      expect(flags.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("WP-SU-21: does NOT seed partners or state_rules (tenant-specific admin setup; state_rules FK partners)", async () => {
    await withBareTenant(async (tenantId) => {
      await seedTenantRules(db, tenantId);
      const partners = await db.select().from(schema.partners).where(eq(schema.partners.tenantId, tenantId));
      const stateRules = await db.select().from(schema.stateRules).where(eq(schema.stateRules.tenantId, tenantId));
      expect(partners).toHaveLength(0);
      expect(stateRules).toHaveLength(0);
    });
  });

  it("WP-SU-21: runs inside a transaction with a tx handle and rolls back cleanly (the provisionSignup path)", async () => {
    // Exercises the exact shape provisionSignup uses — seed with a TX handle (not `db`), inside a
    // transaction — then forces a rollback, proving (a) seedTenantRules accepts a tx, (b) FK order +
    // inserts work uncommitted, (c) a failure leaves NO rows. Verifies the production wiring without
    // polluting the DB (nothing commits), covering audit-data F-1 without a separate test project.
    const tenantId = randomUUID();
    const slug = `rollback-${randomUUID().slice(0, 8)}`;
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.tenants).values({ id: tenantId, name: "Rollback Test", slug });
        await seedTenantRules(tx, tenantId);
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    // Nothing committed: tenant + every seeded row rolled back together.
    const tenants = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    const profiles = await db.select().from(schema.sourceProfiles).where(eq(schema.sourceProfiles.tenantId, tenantId));
    const patterns = await db.select().from(schema.mlsPatterns).where(eq(schema.mlsPatterns.tenantId, tenantId));
    expect(tenants).toHaveLength(0);
    expect(profiles).toHaveLength(0);
    expect(patterns).toHaveLength(0);
  });
});
