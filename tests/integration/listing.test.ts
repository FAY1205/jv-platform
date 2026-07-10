import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { runListingChecks } from "@/modules/listing/run-checks";
import type { ListingCheckProvider } from "@/modules/listing/provider";
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
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-001", filename: "w.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [k] = await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-26-00001", uploadId: up.id, dedupeKey: "1|75001", rawJson: {}, partnerId: p.id, address: "123 Main St", city: "Dallas", state: "TX", zip: "75001", mlsStatus: "kept" }).returning({ id: schema.leads.id });
    const [r] = await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-26-00002", uploadId: up.id, dedupeKey: "2|75002", rawJson: {}, partnerId: p.id, address: "9 Removed Rd", city: "Dallas", state: "TX", zip: "75002", mlsStatus: "removed" }).returning({ id: schema.leads.id });
    keptId = k.id;
    removedId = r.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("LST-01/02/03: checks kept leads (LinkOnly → unknown + link), never removes, skips removed leads", async () => {
    const n = await runListingChecks(db, scope, "IM-26-001");
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

  it("F-08b: a multi-status run groups the flag updates per status (K>1)", async () => {
    // Two kept leads under a fresh run; a stub provider returns a different status
    // per lead, so idsByStatus has two partitions and each must land on its own lead.
    const [up] = await db.insert(schema.uploads).values({ tenantId: scope.tenantId, refId: "IM-26-002", filename: "w2.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [yes] = await db.insert(schema.leads).values({ tenantId: scope.tenantId, refId: "LD-26-00010", uploadId: up.id, dedupeKey: "10|76001", rawJson: {}, address: "1 Yes St", city: "Fort Worth", state: "TX", zip: "76001", mlsStatus: "kept" }).returning({ id: schema.leads.id });
    const [no] = await db.insert(schema.leads).values({ tenantId: scope.tenantId, refId: "LD-26-00011", uploadId: up.id, dedupeKey: "11|76002", rawJson: {}, address: "2 No St", city: "Fort Worth", state: "TX", zip: "76002", mlsStatus: "kept" }).returning({ id: schema.leads.id });

    const stub: ListingCheckProvider = {
      name: "stub",
      check: (lead) => ({ provider: "stub", status: lead.zip === "76001" ? "yes" : "no" }),
    };
    const n = await runListingChecks(db, scope, "IM-26-002", stub);
    expect(n).toBe(2);

    const [yRow] = await db.select().from(schema.leads).where(eq(schema.leads.id, yes.id));
    const [nRow] = await db.select().from(schema.leads).where(eq(schema.leads.id, no.id));
    expect(yRow.possibleMlsListing).toBe("yes");
    expect(nRow.possibleMlsListing).toBe("no"); // grouped separately, not cross-contaminated
  });
});
