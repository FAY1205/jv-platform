import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { DrizzleRunStore } from "@/modules/run/store";
import { processRun } from "@/modules/run/process";
import { voidUpload, AlreadyVoidedError } from "@/modules/run/void";
import { buildCoverage } from "@/modules/pipeline/assign";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import { GENERIC_PROFILE } from "@/modules/sources";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-void-wp018";

suite("WP-018: void-run (ING-09)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let store: DrizzleRunStore;
  let scope: ScopeContext;
  let partnerNJ: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
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
    const [t] = await db.insert(schema.tenants).values({ name: "Void WP018", slug: SLUG }).returning({ id: schema.tenants.id });
    const [p] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "NJ Partner", color: "#8fbfe8", status: "active" }).returning({ id: schema.partners.id });
    partnerNJ = p.id;
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    store = new DrizzleRunStore(db);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const DKEY = "1 a st|08034";

  it("voids a run, records the reason + audit, and drops its leads from future dedupe (ING-09)", async () => {
    // A run that lands one NJ lead (dedupe_key = DKEY).
    const rules = { mlsPatterns: DEFAULT_MLS_PATTERNS, coverage: buildCoverage([], [{ state: "NJ", partnerId: partnerNJ }]) };
    const snapshotInput = { sourceProfile: { id: GENERIC_PROFILE.id, version: GENERIC_PROFILE.version }, mlsPatterns: DEFAULT_MLS_PATTERNS, stateRules: [{ state: "NJ", partnerId: partnerNJ }], zipCoverage: [] };
    const row = { Campaign: "x", "Date Created": "2026-07-06", Notes: "off market", Address: "1 A St", City: "T", State: "NJ", Zip: "08034", "Seller First Name": "A", "Seller Last Name": "B", Phone: "", Email: "", "Reason For Selling": "", Motivation: "", "Time to Sell": "" };
    const result = await processRun(
      { tenantId: scope.tenantId, filename: "w.xlsx", rows: [row], profile: GENERIC_PROFILE, rules, snapshotInput, year: 2026, colorCoding: false },
      { store, clock: () => "2026-07-08T12:00:00.000Z" },
    );

    // Before voiding, the lead is in dedupe history.
    expect((await store.loadHistory(scope.tenantId)).has(DKEY)).toBe(true);

    const voided = await voidUpload(scope, result.uploadRefId, "wrong file uploaded");
    expect(voided.uploadRef).toBe(result.uploadRefId);

    const [upload] = await db.select().from(schema.uploads).where(and(eq(schema.uploads.tenantId, scope.tenantId), eq(schema.uploads.refId, result.uploadRefId)));
    expect(upload.status).toBe("voided");
    expect(upload.voidReason).toBe("wrong file uploaded");
    expect(upload.voidedAt).not.toBeNull();

    // DM-04: the mutation is audited.
    const audits = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, scope.tenantId), eq(schema.auditLog.action, "upload.voided")));
    expect(audits.some((a) => a.entityRef === result.uploadRefId)).toBe(true);

    // ING-09 poison-prevention: the voided lead is no longer in dedupe history.
    expect((await store.loadHistory(scope.tenantId)).has(DKEY)).toBe(false);
  });

  it("rejects voiding an already-voided run", async () => {
    const [upload] = await db.select({ refId: schema.uploads.refId }).from(schema.uploads).where(eq(schema.uploads.tenantId, scope.tenantId));
    await expect(voidUpload(scope, upload.refId, "again")).rejects.toBeInstanceOf(AlreadyVoidedError);
  });
});
