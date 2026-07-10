import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { loadColorCoding, saveColorCoding, loadRetentionDays } from "@/modules/settings/export-settings";

// TST-01 family: DB-backed Data & Export settings (F-39 / SET-01 / SET-07). Self-skips
// without DATABASE_URL so the unit suite stays green; runs against a live Postgres in CI.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG_A = "test-setdata-a";
const SLUG_B = "test-setdata-b";

suite("WS-7g: Data & Export settings (F-39/SET-01, SET-07)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const rows = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = rows.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.settings).where(inArray(schema.settings.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [ta] = await db.insert(schema.tenants).values({ name: "A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    const [tb] = await db.insert(schema.tenants).values({ name: "B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantA = ta.id;
    id.tenantB = tb.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const adminA = (): ScopeContext => ({ tenantId: id.tenantA, role: "admin", userId: randomUUID() });
  const adminB = (): ScopeContext => ({ tenantId: id.tenantB, role: "admin", userId: randomUUID() });

  it("SET-01: color coding defaults ON when no row is stored", async () => {
    expect(await loadColorCoding(adminA())).toBe(true);
  });

  it("F-39: saveColorCoding round-trips (upsert), toggling the value", async () => {
    await saveColorCoding(adminA(), false);
    expect(await loadColorCoding(adminA())).toBe(false);
    await saveColorCoding(adminA(), true); // onConflictDoUpdate path
    expect(await loadColorCoding(adminA())).toBe(true);
  });

  it("PRN-08: one tenant's color-coding setting never leaks to another tenant", async () => {
    await saveColorCoding(adminA(), false);
    expect(await loadColorCoding(adminA())).toBe(false);
    expect(await loadColorCoding(adminB())).toBe(true); // B unaffected — still the default
  });

  it("SET-07: retention days defaults to 365, and reads a stored value", async () => {
    expect(await loadRetentionDays(adminB())).toBe(365);
    await db
      .insert(schema.settings)
      .values({ tenantId: id.tenantB, key: "retention_days", value: 90 })
      .onConflictDoUpdate({ target: [schema.settings.tenantId, schema.settings.key], set: { value: 90 } });
    expect(await loadRetentionDays(adminB())).toBe(90);
    // ...and stays tenant-scoped.
    const [rowA] = await db
      .select({ v: schema.settings.value })
      .from(schema.settings)
      .where(and(eq(schema.settings.tenantId, id.tenantA), eq(schema.settings.key, "retention_days")));
    expect(rowA).toBeUndefined();
  });
});
