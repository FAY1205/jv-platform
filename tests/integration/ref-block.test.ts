import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { allocateRef, allocateRefBlock } from "@/db/ref-ids";

// Runs against a live Postgres (dev DB locally; CI service container). Self-skips
// when DATABASE_URL is unset. Covers the F-08 batch counter allocation: one bump
// of N reserves a contiguous, non-overlapping block, interleaving cleanly with the
// single-allocation path.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-ref-block-ws9";

suite("F-08: batch ref-counter allocation", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let tenantId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.refCounters).where(inArray(schema.refCounters.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Ref Block WS9", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("F-08: reserves a contiguous block of N formatted refs in order", async () => {
    const block = await allocateRefBlock(db, tenantId, "lead", 2026, 3);
    expect(block).toEqual(["LD-26-00001", "LD-26-00002", "LD-26-00003"]);
  });

  it("F-08: a later single allocation continues after the reserved block (no overlap)", async () => {
    const next = await allocateRef(db, tenantId, "lead", 2026);
    expect(next).toBe("LD-26-00004");
    const more = await allocateRefBlock(db, tenantId, "lead", 2026, 2);
    expect(more).toEqual(["LD-26-00005", "LD-26-00006"]);
  });

  it("F-08: a zero-count block reserves nothing and leaves the counter untouched", async () => {
    const none = await allocateRefBlock(db, tenantId, "lead", 2026, 0);
    expect(none).toEqual([]);
    const after = await allocateRef(db, tenantId, "lead", 2026);
    expect(after).toBe("LD-26-00007");
  });
});
