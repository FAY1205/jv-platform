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
    // After uploads: source_profile_id is an FK from uploads (no cascade).
    await db.delete(schema.sourceProfiles).where(inArray(schema.sourceProfiles.tenantId, tids));
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
    coverage: buildCoverage([], [
      { state: "NJ", partnerId: partnerNJ },
      { state: "SC", partnerId: partnerSC },
    ]),
  });
  const snapshotInput = () => ({
    sourceProfile: { id: GENERIC_PROFILE.id, version: GENERIC_PROFILE.version },
    mlsPatterns: DEFAULT_MLS_PATTERNS,
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

    expect(result.uploadRefId).toMatch(/^IM-26-\d{3}$/);
    const leads = await db.select().from(schema.leads).where(eq(schema.leads.tenantId, tenantId));
    expect(leads).toHaveLength(3); // DED-03: every processed lead is stored

    const nj = leads.find((l) => l.dedupeKey === "1 a st|08034")!;
    expect(nj.partnerId).toBe(partnerNJ);
    expect(nj.matchMethod).toBe("state_fallback");
    expect(nj.refId).toMatch(/^LD-26-\d{5}$/);
    expect(nj.firstMatchedAt?.toISOString()).toBe("2026-07-08T12:00:00.000Z");

    const ca = leads.find((l) => l.dedupeKey === "3 c st|90001")!;
    expect(ca.partnerId).toBeNull(); // unmatched
    expect(ca.matchMethod).toBe("none");

    const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.tenantId, tenantId));
    expect(upload.rulesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(upload.rowCount).toBe(3);
    expect(result.exportBytes.byteLength).toBeGreaterThan(0);
  });

  it("ADR-0038: re-running an overlapping row creates a SECOND lead (dedup collapse retired); the original row is untouched", async () => {
    const before = await db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), eq(schema.leads.dedupeKey, "1 a st|08034")));
    expect(before).toHaveLength(1);
    const originalRef = before[0].refId;
    const originalFirstMatched = before[0].firstMatchedAt?.toISOString();

    const rows = [
      row({ Address: "1 A St", State: "NJ", Zip: "08034" }), // repeat → now its OWN lead (no collapse)
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
    expect(after).toHaveLength(2); // ADR-0038: the repeat is a new lead, not collapsed onto the first

    // The ORIGINAL row is never rewritten — its ref-id and first_matched_at are preserved.
    const original = after.find((l) => l.refId === originalRef);
    expect(original).toBeDefined();
    expect(original!.firstMatchedAt?.toISOString()).toBe(originalFirstMatched);

    // The new copy is a fresh lead: a new ref, stamped at THIS run, routed by current coverage.
    const copy = after.find((l) => l.refId !== originalRef)!;
    expect(copy.firstMatchedAt?.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(copy.partnerId).toBe(partnerNJ);

    const fresh = await db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), eq(schema.leads.dedupeKey, "9 new st|08034")));
    expect(fresh).toHaveLength(1);
    expect(result.uploadRefId).toBe("IM-26-002");
  });

  it("F-08a: multiple new leads in one batched run get ref-ids in input order", async () => {
    // Three genuinely-new leads processed in one run. The batched persistRun reserves
    // a contiguous ref block and zips it to the new leads in input order, so their ref
    // numbers must strictly increase in the order the rows were submitted.
    const keys = ["20 alpha st|08034", "21 bravo st|08034", "22 charlie st|08034"];
    const rows = [
      row({ Address: "20 Alpha St", State: "NJ", Zip: "08034" }),
      row({ Address: "21 Bravo St", State: "NJ", Zip: "08034" }),
      row({ Address: "22 Charlie St", State: "NJ", Zip: "08034" }),
    ];
    await processRun(
      { tenantId, filename: "week3.xlsx", rows, profile: GENERIC_PROFILE, rules: rules(), snapshotInput: snapshotInput(), year: 2026, colorCoding: true },
      { store, clock: () => "2026-07-22T00:00:00.000Z" },
    );

    const leads = await db.select({ dedupeKey: schema.leads.dedupeKey, refId: schema.leads.refId }).from(schema.leads).where(and(eq(schema.leads.tenantId, tenantId), inArray(schema.leads.dedupeKey, keys)));
    const num = (ref: string) => Number(ref.split("-")[2]);
    const byKey = new Map(leads.map((l) => [l.dedupeKey, num(l.refId)]));
    expect(byKey.size).toBe(3);
    expect(byKey.get(keys[0])!).toBeLessThan(byKey.get(keys[1])!);
    expect(byKey.get(keys[1])!).toBeLessThan(byKey.get(keys[2])!);
  });

  // ── Source Profile provenance on the upload row (ING-07, DM-08) ──
  // The run's profile is already pinned inside rules_snapshot; these cases prove the
  // dedicated uploads columns are populated too, so provenance is joinable rather than
  // recoverable only by parsing the snapshot JSON.

  it("ING-07: a saved profile's id and version are recorded on the upload row", async () => {
    const [saved] = await db
      .insert(schema.sourceProfiles)
      .values({
        tenantId,
        name: "Saved Format",
        version: 3,
        headerSignature: GENERIC_PROFILE.headerSignature,
        mapping: GENERIC_PROFILE.mapping,
        requiredColumns: GENERIC_PROFILE.requiredColumns,
        strictness: "flexible",
      })
      .returning({ id: schema.sourceProfiles.id });

    const profile = { ...GENERIC_PROFILE, id: saved.id, name: "Saved Format", version: 3 };
    const result = await processRun(
      {
        tenantId,
        filename: "saved-profile.xlsx",
        rows: [row({ Address: "30 Delta St", State: "NJ", Zip: "08034" })],
        profile,
        rules: rules(),
        snapshotInput: { ...snapshotInput(), sourceProfile: { id: profile.id, version: profile.version } },
        year: 2026,
        colorCoding: true,
      },
      { store, clock: () => "2026-07-29T00:00:00.000Z" },
    );

    const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.refId, result.uploadRefId));
    expect(upload.sourceProfileId).toBe(saved.id);
    expect(upload.sourceProfileVersion).toBe(3);
  });

  it("ING-07: a built-in seed profile records its version with a null id (slug ids are not uuids)", async () => {
    // Seeds like GENERIC_PROFILE carry slug ids ("generic") and have no source_profiles
    // row, so the uuid FK column must stay NULL — the version still pins the format.
    const result = await processRun(
      {
        tenantId,
        filename: "seed-profile.xlsx",
        rows: [row({ Address: "31 Echo St", State: "NJ", Zip: "08034" })],
        profile: GENERIC_PROFILE,
        rules: rules(),
        snapshotInput: snapshotInput(),
        year: 2026,
        colorCoding: true,
      },
      { store, clock: () => "2026-07-30T00:00:00.000Z" },
    );

    const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.refId, result.uploadRefId));
    expect(upload.sourceProfileId).toBeNull();
    expect(upload.sourceProfileVersion).toBe(GENERIC_PROFILE.version);
    // The snapshot keeps the slug id, so the format is still identifiable.
    expect((upload.rulesSnapshot as { sourceProfile: { id: string } }).sourceProfile.id).toBe("generic");
  });
});
