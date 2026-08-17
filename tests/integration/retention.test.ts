import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { sweepTenantPii } from "@/modules/retention/sweep";
import { REDACTED_RAW_JSON, REDACTED_NOTE_BODY, REDACTED_TASK_TITLE, REDACTED_DEDUPE_KEY, REDACTED_NOTIFICATION_TITLE, REDACTED_OUTBOX_SUBJECT } from "@/modules/retention/purge";

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
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
    await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.tenantId, tids));
    await db.delete(schema.leadTasks).where(inArray(schema.leadTasks.tenantId, tids));
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
    // WP-TSK-2 (audit F-5): task titles are the same human-typed free text, on the same leads.
    await db.insert(schema.leadTasks).values([
      { tenantId: tenantA, leadId: idSoftDeleted, authorUserId: adminId, authorRole: "admin", title: "call Jane at 555-867-5309" },
      { tenantId: tenantA, leadId: idLive, authorUserId: adminId, authorRole: "admin", title: "live lead task stays" },
    ]);
    // C-13 / WP-RET-3a: a task_due notification + its outbox email carry the task free text (seller
    // PII) verbatim, correlated to the lead by refId (lead_ref / meta.leadRef). One on the purged
    // lead (LD-26-00001), one on the LIVE lead (LD-26-00002) which must survive.
    await db.insert(schema.notifications).values([
      { tenantId: tenantA, userId: adminId, type: "task_due", title: "Task due: call Jane at 555-867-5309", body: "Lead LD-26-00001", leadRef: "LD-26-00001" },
      { tenantId: tenantA, userId: adminId, type: "task_due", title: "Task due: live lead task stays", body: "Lead LD-26-00002", leadRef: "LD-26-00002" },
    ]);
    await db.insert(schema.emailOutbox).values([
      { tenantId: tenantA, toAddress: "admin@retention.test", subject: "Task due: call Jane at 555-867-5309", body: "call Jane at 555-867-5309", kind: "task_due", status: "sent", meta: { leadRef: "LD-26-00001" } },
      { tenantId: tenantA, toAddress: "admin@retention.test", subject: "Task due: live lead task stays", body: "live text", kind: "task_due", status: "sent", meta: { leadRef: "LD-26-00002" } },
    ]);
    // PRN-08 collision fixture: tenant B has a lead with the SAME refId (LD-26-00001, refIds are
    // per-tenant), plus a notification + outbox row referencing it. Sweeping tenant A must NOT reach
    // tenant B's comms — proves both UPDATEs in redactLeadCommunications carry the tenant predicate.
    const adminB = randomUUID();
    await db.insert(schema.users).values({ id: adminB, tenantId: tenantB, email: "admin@retention-b.test", role: "admin" });
    await db.insert(schema.notifications).values({ tenantId: tenantB, userId: adminB, type: "task_due", title: "Task due: B-tenant secret", body: "b", leadRef: "LD-26-00001" });
    await db.insert(schema.emailOutbox).values({ tenantId: tenantB, toAddress: "admin@retention-b.test", subject: "Task due: B-tenant secret", body: "b", kind: "task_due", status: "sent", meta: { leadRef: "LD-26-00001" } });
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
    expect(res.tasksRedacted).toBe(1);
    // C-13: the purged lead's notification + outbox row are redacted; the live lead's survive.
    expect(res.notificationsRedacted).toBe(1);
    expect(res.outboxRedacted).toBe(1);
    const notifs = await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, tenantA));
    const byRef = Object.fromEntries(notifs.map((n) => [n.leadRef, n.title]));
    expect(byRef["LD-26-00001"]).toBe(REDACTED_NOTIFICATION_TITLE); // purged lead → redacted
    expect(byRef["LD-26-00002"]).toBe("Task due: live lead task stays"); // live lead → untouched
    const outbox = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, tenantA));
    const outByRef = Object.fromEntries(outbox.map((o) => [(o.meta as { leadRef: string }).leadRef, o.subject]));
    expect(outByRef["LD-26-00001"]).toBe(REDACTED_OUTBOX_SUBJECT);
    expect(outByRef["LD-26-00002"]).toBe("Task due: live lead task stays");
    // PRN-08: tenant B's notification + outbox referencing the SAME refId are UNTOUCHED (the sweep of
    // tenant A must not cross the tenant wall on a colliding refId).
    const bNotif = await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, tenantB));
    expect(bNotif[0].title).toBe("Task due: B-tenant secret");
    const bOutbox = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.tenantId, tenantB));
    expect(bOutbox[0].subject).toBe("Task due: B-tenant secret");

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
    // …and its task titles (SEC-05), by the same statement pair.
    const tasks = await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.leadId, idSoftDeleted));
    expect(tasks.every((t) => t.title === REDACTED_TASK_TITLE)).toBe(true);
  });

  it("LGL-02: leaves a live lead (and its note + task) untouched", async () => {
    const live = await getLead(idLive);
    expect(live.email).toBe(PII.email);
    expect(live.address).toBe(PII.address);
    expect(live.rawJson).toEqual(PII.rawJson);
    expect(live.piiPurgedAt).toBeNull();

    const liveNotes = await db.select().from(schema.leadNotes).where(eq(schema.leadNotes.leadId, idLive));
    expect(liveNotes[0].body).toBe("live lead note stays");
    const liveTasks = await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.leadId, idLive));
    expect(liveTasks[0].title).toBe("live lead task stays");
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
    // C-37: the per-lead audit row records ALL four per-artifact counts (not just notes/tasks), so an
    // auditor reconstructing "what was redacted for lead X" needs only audit_log. The purged lead had
    // one notification + one outbox row (LD-26-00001).
    expect(audits[0].after).toMatchObject({
      piiPurged: true,
      notesRedacted: 1,
      tasksRedacted: 1,
      notificationsRedacted: 1,
      outboxRedacted: 1,
    });
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
