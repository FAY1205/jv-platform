import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { sweepTenantPii } from "@/modules/retention/sweep";
import { REDACTED_RAW_JSON, REDACTED_NOTE_BODY, REDACTED_DEDUPE_KEY } from "@/modules/retention/purge";

// WP-GL-B (DM-09 / LGL-02 / SEC-05): the retention sweep is the BACKSTOP — it redacts seller PII
// from ANY soft-deleted-but-unpurged lead (the default grace is 0). Voiding purges immediately in
// its own transaction (proven in void.test.ts); this proves the sweep catches strays.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG_A = "test-retention-a";
const SLUG_B = "test-retention-b";

suite("WP-GL-B: retention PII sweep — backstop (DM-09 / LGL-02)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let tenantA: string;
  let tenantB: string;
  const now = new Date("2026-07-13T00:00:00.000Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  const PII = {
    sellerFirst: "Jane",
    sellerLast: "Doe",
    phone: "555-867-5309",
    phoneNorm: "5558675309",
    email: "jane@example.com",
    reasonForSelling: "relocating",
    motivation: "high",
    timeToSell: "asap",
    notes: "private seller note",
    address: "123 Main St",
    addressNormalized: "123 main st",
    city: "Springfield",
    state: "IL",
    zip: "62704",
    rawJson: { "Seller First Name": "Jane", Phone: "555-867-5309", Email: "jane@example.com" },
  };

  async function cleanup() {
    const t = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leadNotes).where(inArray(schema.leadNotes.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  async function makeUpload(tenantId: string, ref: string): Promise<string> {
    const [u] = await db
      .insert(schema.uploads)
      .values({ tenantId, refId: ref, filename: "f.xlsx", status: "processed" })
      .returning({ id: schema.uploads.id });
    return u.id;
  }

  async function insertLead(tenantId: string, uploadId: string, ref: string, deletedAt: Date | null): Promise<string> {
    const [l] = await db
      .insert(schema.leads)
      .values({ tenantId, refId: ref, uploadId, dedupeKey: `key-${ref}`, deletedAt, ...PII })
      .returning({ id: schema.leads.id });
    return l.id;
  }

  let idSoftDeleted: string, idLive: string, idOtherTenant: string;

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [a] = await db.insert(schema.tenants).values({ name: "Retention A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    const [b] = await db.insert(schema.tenants).values({ name: "Retention B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    tenantA = a.id;
    tenantB = b.id;
    const upA = await makeUpload(tenantA, "IM-26-001");
    const upB = await makeUpload(tenantB, "IM-26-001");
    idSoftDeleted = await insertLead(tenantA, upA, "LD-26-00001", daysAgo(5)); // soft-deleted → eligible (grace 0)
    idLive = await insertLead(tenantA, upA, "LD-26-00002", null); // live → never eligible
    idOtherTenant = await insertLead(tenantB, upB, "LD-26-00001", daysAgo(5)); // soft-deleted, a DIFFERENT tenant

    // A free-text note carrying seller PII on the to-be-purged lead, and one on the live lead.
    const adminId = randomUUID();
    await db.insert(schema.users).values({ id: adminId, tenantId: tenantA, email: "admin@retention.test", role: "admin" });
    await db.insert(schema.leadNotes).values([
      { tenantId: tenantA, leadId: idSoftDeleted, authorUserId: adminId, authorRole: "admin", body: "called Jane at 555-867-5309" },
      { tenantId: tenantA, leadId: idLive, authorUserId: adminId, authorRole: "admin", body: "live lead note stays" },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const getLead = async (id: string) => (await db.select().from(schema.leads).where(eq(schema.leads.id, id)))[0];

  it("DM-09/SEC-05: redacts seller PII (incl. street address + dedupe key) from a soft-deleted lead, keeps coarse location", async () => {
    const res = await sweepTenantPii(db, { tenantId: tenantA, now });
    expect(res.purged).toBe(1);
    expect(res.notesRedacted).toBe(1);

    const l = await getLead(idSoftDeleted);
    expect(l.sellerFirst).toBeNull();
    expect(l.sellerLast).toBeNull();
    expect(l.phone).toBeNull();
    expect(l.phoneNorm).toBeNull();
    expect(l.email).toBeNull();
    expect(l.reasonForSelling).toBeNull();
    expect(l.motivation).toBeNull();
    expect(l.timeToSell).toBeNull();
    expect(l.notes).toBeNull();
    expect(l.address).toBeNull();
    expect(l.addressNormalized).toBeNull();
    expect(l.dedupeKey).toBe(REDACTED_DEDUPE_KEY);
    expect(l.rawJson).toEqual(REDACTED_RAW_JSON);
    expect(l.piiPurgedAt).not.toBeNull();
    // kept: coarse location + identity/decision columns (audit trail DM-04, ref-id DM-07)
    expect(l.city).toBe(PII.city);
    expect(l.state).toBe(PII.state);
    expect(l.zip).toBe(PII.zip);
    expect(l.refId).toBe("LD-26-00001");
    expect(l.deletedAt).not.toBeNull();

    // the lead's free-text note (which held seller PII) is redacted too.
    const notes = await db.select().from(schema.leadNotes).where(eq(schema.leadNotes.leadId, idSoftDeleted));
    expect(notes.every((n) => n.body === REDACTED_NOTE_BODY)).toBe(true);
  });

  it("LGL-02: leaves a live lead (and its note) untouched", async () => {
    const live = await getLead(idLive);
    expect(live.email).toBe(PII.email);
    expect(live.address).toBe(PII.address);
    expect(live.rawJson).toEqual(PII.rawJson);
    expect(live.piiPurgedAt).toBeNull();

    const liveNotes = await db.select().from(schema.leadNotes).where(eq(schema.leadNotes.leadId, idLive));
    expect(liveNotes[0].body).toBe("live lead note stays");
  });

  it("DM-04/SEC-05: writes one append-only audit row per purged lead, carrying no PII", async () => {
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, tenantA), eq(schema.auditLog.action, "lead.pii_purged")));
    expect(audits.length).toBe(1);
    expect(audits[0].entityType).toBe("lead");
    expect(audits[0].entityRef).toBe("LD-26-00001");
    expect(audits[0].actorUserId).toBeNull(); // system actor
    const blob = (JSON.stringify(audits[0].before) + JSON.stringify(audits[0].after)).toLowerCase();
    expect(blob).not.toContain("jane");
    expect(blob).not.toContain("5558675309");
    expect(blob).not.toContain("example.com");
    expect(blob).not.toContain("main st");
  });

  it("PRN-08: never touches another tenant's eligible lead", async () => {
    const other = await getLead(idOtherTenant);
    expect(other.email).toBe(PII.email);
    expect(other.piiPurgedAt).toBeNull();
  });

  it("idempotent: a second sweep purges nothing and adds no duplicate audit rows", async () => {
    const res = await sweepTenantPii(db, { tenantId: tenantA, now });
    expect(res.purged).toBe(0);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, tenantA), eq(schema.auditLog.action, "lead.pii_purged")));
    expect(audits.length).toBe(1);
  });
});
