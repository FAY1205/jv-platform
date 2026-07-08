import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { runListingChecks } from "@/modules/listing/run-checks";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-listing-wp033";

suite("WP-033: LinkOnly listing check (LST-01/02/03)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let keptId: string;
  let removedId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    for (const tbl of [schema.listingChecks, schema.leads, schema.uploads, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Listing", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [p] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "UP-2026-001", filename: "w.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [k] = await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-2026-00001", uploadId: up.id, dedupeKey: "1|75001", rawJson: {}, partnerId: p.id, address: "123 Main St", city: "Dallas", state: "TX", zip: "75001", mlsStatus: "kept" }).returning({ id: schema.leads.id });
    const [r] = await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-2026-00002", uploadId: up.id, dedupeKey: "2|75002", rawJson: {}, partnerId: p.id, address: "9 Removed Rd", city: "Dallas", state: "TX", zip: "75002", mlsStatus: "removed" }).returning({ id: schema.leads.id });
    keptId = k.id;
    removedId = r.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("LST-01/02/03: checks kept leads (LinkOnly → unknown + link), never removes, skips removed leads", async () => {
    const n = await runListingChecks(db, scope, "UP-2026-001");
    expect(n).toBe(1); // only the kept lead

    const checks = await db.select().from(schema.listingChecks).where(eq(schema.listingChecks.tenantId, scope.tenantId));
    expect(checks).toHaveLength(1);
    expect(checks[0].leadId).toBe(keptId);
    expect(checks[0].provider).toBe("link_only");
    expect(checks[0].status).toBe("unknown");
    expect((checks[0].result as { link?: string }).link).toContain("google.com/search");

    // LST-01: the flag is surfaced on the kept lead...
    const [kept] = await db.select().from(schema.leads).where(eq(schema.leads.id, keptId));
    expect(kept.possibleMlsListing).toBe("unknown");
    expect(kept.mlsStatus).toBe("kept"); // LST-03/PRN-09: NEVER removed

    // ...and the removed lead was untouched (not checked).
    const [removed] = await db.select().from(schema.leads).where(eq(schema.leads.id, removedId));
    expect(removed.possibleMlsListing).toBe("pending");
  });
});
