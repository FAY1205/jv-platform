import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { bulkAssignLeads, bulkAssignByCoverage } from "@/modules/leads/commands";
import { unmatchedCoverageMatches } from "@/modules/leads/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-bulk-assign-s6";

// Slice 6 part 2 (ASN-03 / PRN-05): bulk manual assignment + coverage backfill.
// Both only ever write the ADDITIVE manual overlay — the import snapshot
// (partnerId / matchMethod) is never rewritten.
suite("S6: bulk assign + coverage backfill", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let partnerA: string; // state rule: TX
  let partnerB: string; // zip override: 75001
  let refs: Record<string, string>;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    for (const tbl of [schema.leads, schema.uploads, schema.coverageZips, schema.stateRules, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Bulk", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [pa] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "Alpha", color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id });
    const [pb] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "Bravo", color: "#5b7a9e", status: "active" }).returning({ id: schema.partners.id });
    partnerA = pa.id;
    partnerB = pb.id;
    // Coverage: A covers TX by state rule; B has a zip override inside TX (beats state);
    // an EXPIRED override for 75002 must be ignored (effectiveTo set, DM-06).
    await db.insert(schema.stateRules).values({ tenantId: t.id, state: "TX", partnerId: partnerA });
    await db.insert(schema.coverageZips).values({ tenantId: t.id, zip5: "75001", partnerId: partnerB });
    await db.insert(schema.coverageZips).values({ tenantId: t.id, zip5: "75002", partnerId: partnerB, effectiveTo: new Date() });

    const [u] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-901", status: "processed", filename: "x.csv" }).returning({ id: schema.uploads.id });
    let n = 0;
    const mk = async (v: Partial<typeof schema.leads.$inferInsert>) => {
      const refId = `LD-26-9${String(n++).padStart(4, "0")}`;
      await db.insert(schema.leads).values({ tenantId: t.id, refId, uploadId: u.id, dedupeKey: randomUUID(), rawJson: {}, mlsStatus: "kept", matchMethod: "none", ...v });
      return refId;
    };
    refs = {
      txPlain1: await mk({ state: "TX", zip: "76000" }),
      txPlain2: await mk({ state: "tx", zip: "76001" }), // lowercase state must still match TX
      txZipB: await mk({ state: "TX", zip: "75001" }),   // zip override → B, not A
      txZipExpired: await mk({ state: "TX", zip: "75002" }), // expired override → falls back to A
      noCoverage: await mk({ state: "MT", zip: "59000" }),   // nothing covers MT
      routed: await mk({ state: "TX", zip: "76002", partnerId: partnerA, matchMethod: "state_fallback" }),
      manual: await mk({ state: "TX", zip: "76003", manualPartnerId: partnerB }),
      removed: await mk({ state: "TX", zip: "76004", mlsStatus: "removed" }),
    };
  });

  afterAll(async () => { await cleanup(); await client.end(); });

  it("ASN-03: coverage matches use zip-beats-state precedence, skip expired rows, and count only unmatched leads", async () => {
    const matches = await unmatchedCoverageMatches(scope);
    const byPartner = new Map(matches.map((m) => [m.partnerId, m]));
    // A: txPlain1, txPlain2 (case-folded), txZipExpired (expired override falls back to the state rule)
    expect(byPartner.get(partnerA)?.count).toBe(3);
    // B: only the live zip override
    expect(byPartner.get(partnerB)?.count).toBe(1);
    expect(byPartner.get(partnerB)?.refId).toBe("JV-002");
  });

  it("PRN-05: bulkAssignLeads writes only the manual overlay for eligible leads and reports skips", async () => {
    const result = await bulkAssignLeads(scope, {
      leadRefs: [refs.txPlain1, refs.routed, refs.manual, refs.removed, "LD-26-99999"],
      partnerId: partnerA,
    });
    expect(result.partnerRefId).toBe("JV-001");
    expect(result.assigned).toEqual([refs.txPlain1]);
    expect(result.skipped.sort()).toEqual([refs.manual, refs.removed, refs.routed, "LD-26-99999"].sort());

    const [row] = await db.select().from(schema.leads).where(and(eq(schema.leads.tenantId, scope.tenantId), eq(schema.leads.refId, refs.txPlain1)));
    expect(row.manualPartnerId).toBe(partnerA);
    expect(row.partnerId).toBeNull(); // snapshot untouched (PRN-05)
    expect(row.manualAssignedBy).toBe(scope.userId);

    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, scope.tenantId));
    expect(audits.filter((a) => a.action === "lead.manually_assigned").length).toBe(1);
  });

  it("ASN-03: bulkAssignByCoverage assigns exactly the partner's coverage matches, atomically", async () => {
    const result = await bulkAssignByCoverage(scope, partnerB);
    expect(result.assigned).toEqual([refs.txZipB]);

    // A's backfill picks up its remaining state-rule matches (txPlain2 + txZipExpired;
    // txPlain1 was manually assigned in the previous test and must be skipped now).
    const resultA = await bulkAssignByCoverage(scope, partnerA);
    expect(resultA.assigned.sort()).toEqual([refs.txPlain2, refs.txZipExpired].sort());

    // Nothing re-derives for either partner afterwards; MT lead stays unmatched.
    expect(await unmatchedCoverageMatches(scope)).toEqual([]);
    const [mt] = await db.select().from(schema.leads).where(and(eq(schema.leads.tenantId, scope.tenantId), eq(schema.leads.refId, refs.noCoverage)));
    expect(mt.manualPartnerId).toBeNull();
  });
});
