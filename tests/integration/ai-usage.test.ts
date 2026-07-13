import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { recordUsage, monthToDateMicroUsd, questionsInLastMinute } from "@/modules/ai/usage";
import { loadAiSettings, saveAiSettings } from "@/modules/ai/settings";
import { AI_MODEL } from "@/modules/ai/pricing";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-ai-usage-wpai1";
const SLUG_B = "test-ai-usage-wpai1-b";
const NOW = new Date("2026-07-13T12:00:00Z");
const OTHER_USER_ID = randomUUID();

suite("WP-AI-1 Task 9: ai_usage metering (AIA-06/BIL-04/SET-11)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scopeA: ScopeContext;
  let scopeB: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [schema.aiUsage, schema.settings, schema.users, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();

    const [tA] = await db.insert(schema.tenants).values({ slug: SLUG, name: "AI Usage Test A" }).returning({ id: schema.tenants.id });
    const [tB] = await db.insert(schema.tenants).values({ slug: SLUG_B, name: "AI Usage Test B" }).returning({ id: schema.tenants.id });

    const adminUserIdA = randomUUID();
    const adminUserIdB = randomUUID();
    await db.insert(schema.users).values([
      { id: adminUserIdA, tenantId: tA.id, email: "admin-a@t.test", role: "admin" },
      { id: adminUserIdB, tenantId: tB.id, email: "admin-b@t.test", role: "admin" },
    ]);

    scopeA = { tenantId: tA.id, role: "admin", userId: adminUserIdA } as ScopeContext;
    scopeB = { tenantId: tB.id, role: "admin", userId: adminUserIdB } as ScopeContext;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("AIA-06: records usage and sums month-to-date per tenant only (PRN-08)", async () => {
    await recordUsage(db, scopeA, { userId: scopeA.userId, model: AI_MODEL, inputTokens: 6000, outputTokens: 500, costMicroUsd: 2250 });
    await recordUsage(db, scopeB, { userId: scopeB.userId, model: AI_MODEL, inputTokens: 9999, outputTokens: 9999, costMicroUsd: 999_999 });
    expect(await monthToDateMicroUsd(db, scopeA, NOW)).toBe(2250); // B's spend invisible
  });

  it("rate window counts only this user's last-60s questions", async () => {
    expect(await questionsInLastMinute(db, scopeA, scopeA.userId, NOW)).toBe(1);
    expect(await questionsInLastMinute(db, scopeA, OTHER_USER_ID, NOW)).toBe(0);
  });

  it("AIA-06: rate window excludes rows older than 60s", async () => {
    // Insert a second row for the same user, then backdate ONLY it to well before
    // the 60s window; the window is the rate-limit control, so its EXCLUSION edge
    // must be proven — a widened window (e.g. 60_000 → 600_000) would regress here.
    const [old] = await db.insert(schema.aiUsage)
      .values({ tenantId: scopeA.tenantId, userId: scopeA.userId, model: AI_MODEL, inputTokens: 100, outputTokens: 100, costMicroUsd: 1 })
      .returning({ id: schema.aiUsage.id });
    await db.update(schema.aiUsage).set({ createdAt: new Date(NOW.getTime() - 120_000) }).where(eq(schema.aiUsage.id, old.id));
    // Still 1 (only the in-window row from test 1) — the >60s row is filtered out, NOT counted as 2.
    expect(await questionsInLastMinute(db, scopeA, scopeA.userId, NOW)).toBe(1);
  });

  it("SET-11: ai settings round-trip with defaults (off, $10) until saved", async () => {
    expect(await loadAiSettings(scopeA)).toEqual({ enabled: false, capUsd: 10 });
    await saveAiSettings(scopeA, { enabled: true, capUsd: 25 });
    expect(await loadAiSettings(scopeA)).toEqual({ enabled: true, capUsd: 25 });
  });
});
