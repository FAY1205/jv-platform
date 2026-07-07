import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { DrizzleRunStore } from "@/modules/run/store";
import { processRun } from "@/modules/run/process";
import { buildCoverage } from "@/modules/pipeline/assign";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import { GENERIC_PROFILE } from "@/modules/sources";

// Runs against a live Postgres (dev DB locally; a service container in CI). Self-skips
// when DATABASE_URL is unset so the fast unit suite stays green (same pattern as TST-01).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-run-wp017b";

suite("WP-017b: run persistence (DrizzleRunStore)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let store: DrizzleRunStore;
  let tenantId: string;
  let partnerNJ: string;
  let partnerSC: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.refCounters).where(inArray(schema.refCounters.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Run WP017b", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    const [pnj] = await db.insert(schema.partners).values({ tenantId, refId: "JV-001", name: "NJ Partner", color: "#8fbfe8", status: "active" }).returning({ id: schema.partners.id });
    const [psc] = await db.insert(schema.partners).values({ tenantId, refId: "JV-002", name: "SC Partner", color: "#e8927c", status: "active" }).returning({ id: schema.partners.id });
    partnerNJ = pnj.id;
    partnerSC = psc.id;
    store = new DrizzleRunStore(db);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const rules = () => ({
    mlsPatterns: DEFAULT_MLS_PATTERNS,
    recodes: [{ matchPattern: "Lead Zolo*", code: "Z" }],
    coverage: buildCoverage([], [
      { state: "NJ", partnerId: partnerNJ },
      { state: "SC", partnerId: partnerSC },
    ]),
  });
  const snapshotInput = () => ({
    sourceProfile: { id: GENERIC_PROFILE.id, version: GENERIC_PROFILE.version },
    mlsPatterns: DEFAULT_MLS_PATTERNS,
    recodes: [{ matchPattern: "Lead Zolo*", code: "Z" }],
    stateRules: [
      { state: "NJ", partnerId: partnerNJ },
      { state: "SC", partnerId: partnerSC },
    ],
    zipCoverage: [],
  });

  function row(over: Record<string, string>): Record<string, string> {
    return {
      Campaign: "Lead Zolo 1.0",
      "Date Created": "2026-07-06",
      Notes: "off market",
      Address: "1 A St",
      City: "Town",
      State: "NJ",
      Zip: "08034",
      "Seller First Name": "A",
      "Seller Last Name": "B",
      Phone: "(856) 555-0100",
      Email: "a@example.test",
      "Reason For Selling": "x",
      Motivation: "y",
      "Time to Sell": "z",
      ...over,
    };
  }

  const clock = () => "2026-07-08T12:00:00.000Z";

  it("persists the upload + leads with ref-ids and a rules hash (DM-07/08, PRN-08)", async () => {
    const rows = [
      row({ Address: "1 A St", State: "NJ", Zip: "08034" }),
      row({ Address: "2 B St", State: "SC", Zip: "29601" }),
      row({ Address: "3 C St", State: "CA", Zip: "90001" }), // out of territory → unmatched
    ];
    const result = await processRun(
      { tenantId, filename: "week1.xlsx", rows, profile: GENERIC_PROFILE, rules: rules(), snapshotInput: snapshotInput(), year: 2026, colorCoding: true },
      { store, clock },
    );

    expect(result.uploadRefId).toMatch(/^UP-2026-\d{3}$/);
    const leads = await db.select().from(schema.leads).where(eq(schema.leads.tenantId, tenantId));
    expect(leads).toHaveLength(3); // DED-03: every processed lead is stored

    const nj = leads.find((l) => l.dedupeKey === "1 a st|08034")!;
    expect(nj.partnerId).toBe(partnerNJ);
    expect(nj.matchMethod).toBe("state_fallback");
    expect(nj.refId).toMatch(/^LD-2026-\d{5}$/);
    expect(nj.firstMatchedAt?.toISOString()).toBe("2026-07-08T12:00:00.000Z");

    const ca = leads.find((l) => l.dedupeKey === "3 c st|90001")!;
    expect(ca.partnerId).toBeNull(); // unmatched
    expect(ca.matchMethod).toBe("none");

    const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.tenantId, tenantId));
    expect(upload.rulesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(upload.rowCount).toBe(3);
    expect(result.exportBytes.byteLength).toBeGreaterThan(0);
  });

  it("PRN-05: re-running an overlapping lead never duplicates it and leaves the original untouched", async () => {
    const before = await db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), eq(schema.leads.dedupeKey, "1 a st|08034")));
    const originalRef = before[0].refId;
    const originalFirstMatched = before[0].firstMatchedAt?.toISOString();

    const rows = [
      row({ Address: "1 A St", State: "NJ", Zip: "08034" }), // repeat → must not duplicate
      row({ Address: "9 New St", State: "NJ", Zip: "08034" }), // genuinely new
    ];
    const result = await processRun(
      { tenantId, filename: "week2.xlsx", rows, profile: GENERIC_PROFILE, rules: rules(), snapshotInput: snapshotInput(), year: 2026, colorCoding: true },
      { store, clock: () => "2026-07-15T00:00:00.000Z" },
    );

    const after = await db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), eq(schema.leads.dedupeKey, "1 a st|08034")));
    expect(after).toHaveLength(1); // not duplicated (unique dedupe_key honored)
    expect(after[0].refId).toBe(originalRef); // original row untouched
    expect(after[0].firstMatchedAt?.toISOString()).toBe(originalFirstMatched); // first_matched_at preserved

    const fresh = await db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), eq(schema.leads.dedupeKey, "9 new st|08034")));
    expect(fresh).toHaveLength(1);
    expect(result.uploadRefId).toBe("UP-2026-002");
  });
});
