import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { DrizzleRunStore } from "@/modules/run/store";
import { processRun } from "@/modules/run/process";
import { voidUpload, AlreadyVoidedError, VoidWindowClosedError, NotLatestImportError, AlreadyDistributedError } from "@/modules/run/void";
import { REDACTED_RAW_JSON, REDACTED_NOTE_BODY, REDACTED_TASK_TITLE, REDACTED_DEDUPE_KEY } from "@/modules/retention/purge";
import { listPartnerLeads } from "@/modules/portal/queries";
import { getRunDetail } from "@/modules/run/queries";
import { getRunExportData } from "@/modules/run/export-data";
import { updateLeadStatus, LeadNotFoundError } from "@/modules/portal/status-update";
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
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
    await db.delete(schema.leadTasks).where(inArray(schema.leadTasks.tenantId, tids));
    await db.delete(schema.leadNotes).where(inArray(schema.leadNotes.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.refCounters).where(inArray(schema.refCounters.tenantId, tids));
    await db.delete(schema.settings).where(inArray(schema.settings.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
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

  it("voids a run, records the reason + audit, and soft-deletes its leads (ING-09)", async () => {
    // A run that lands one NJ lead (dedupe_key = DKEY).
    const rules = { mlsPatterns: DEFAULT_MLS_PATTERNS, coverage: buildCoverage([], [{ state: "NJ", partnerId: partnerNJ }]) };
    const snapshotInput = { sourceProfile: { id: GENERIC_PROFILE.id, version: GENERIC_PROFILE.version }, mlsPatterns: DEFAULT_MLS_PATTERNS, stateRules: [{ state: "NJ", partnerId: partnerNJ }], zipCoverage: [] };
    const row = { Campaign: "x", "Date Created": "2026-07-06", Notes: "off market", Address: "1 A St", City: "T", State: "NJ", Zip: "08034", "Seller First Name": "A", "Seller Last Name": "B", Phone: "", Email: "", "Reason For Selling": "", Motivation: "", "Time to Sell": "" };
    const result = await processRun(
      { tenantId: scope.tenantId, filename: "w.xlsx", rows: [row], profile: GENERIC_PROFILE, rules, snapshotInput, year: 2026, colorCoding: false },
      { store, clock: () => "2026-07-08T12:00:00.000Z" },
    );

    // Before voiding, the lead row is live.
    const liveBefore = await db.select({ id: schema.leads.id }).from(schema.leads).where(and(eq(schema.leads.tenantId, scope.tenantId), eq(schema.leads.dedupeKey, DKEY)));
    expect(liveBefore.length).toBe(1);

    const voided = await voidUpload(scope, result.uploadRefId, "wrong file uploaded");
    expect(voided.uploadRef).toBe(result.uploadRefId);

    const [upload] = await db.select().from(schema.uploads).where(and(eq(schema.uploads.tenantId, scope.tenantId), eq(schema.uploads.refId, result.uploadRefId)));
    expect(upload.status).toBe("voided");
    expect(upload.voidReason).toBe("wrong file uploaded");
    expect(upload.voidedAt).not.toBeNull();

    // DM-04: the mutation is audited.
    const audits = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, scope.tenantId), eq(schema.auditLog.action, "upload.voided")));
    expect(audits.some((a) => a.entityRef === result.uploadRefId)).toBe(true);

    // ING-09: the voided run's lead is soft-deleted (its key redacted by the WP-GL-B purge).
    const liveAfter = await db
      .select({ deletedAt: schema.leads.deletedAt })
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, scope.tenantId), eq(schema.leads.dedupeKey, DKEY)));
    expect(liveAfter.every((l) => l.deletedAt !== null)).toBe(true);
  });

  it("rejects voiding an already-voided run", async () => {
    const [upload] = await db.select({ refId: schema.uploads.refId }).from(schema.uploads).where(eq(schema.uploads.tenantId, scope.tenantId));
    await expect(voidUpload(scope, upload.refId, "again")).rejects.toBeInstanceOf(AlreadyVoidedError);
  });

  it("ING-09: rejects voiding a run whose 5-minute grace window has closed", async () => {
    // A run created 11 min ago — backdated via the runner clock, the SAME clock voidUpload
    // compares against (new Date()), so this is robust to DB/runner clock skew.
    const [up] = await db
      .insert(schema.uploads)
      .values({
        tenantId: scope.tenantId,
        refId: "IM-26-990",
        filename: "old.xlsx",
        status: "processed",
        createdAt: new Date(Date.now() - 11 * 60 * 1000),
      })
      .returning({ refId: schema.uploads.refId });
    await expect(voidUpload(scope, up.refId, "too late")).rejects.toBeInstanceOf(VoidWindowClosedError);
  });

  // Process one NJ lead (→ partnerNJ) from a given address; distinct addresses ⇒ distinct dedupe_keys.
  async function processNjRun(address: string): Promise<string> {
    const rules = { mlsPatterns: DEFAULT_MLS_PATTERNS, coverage: buildCoverage([], [{ state: "NJ", partnerId: partnerNJ }]) };
    const snapshotInput = { sourceProfile: { id: GENERIC_PROFILE.id, version: GENERIC_PROFILE.version }, mlsPatterns: DEFAULT_MLS_PATTERNS, stateRules: [{ state: "NJ", partnerId: partnerNJ }], zipCoverage: [] };
    const row = { Campaign: "x", "Date Created": "2026-07-06", Notes: "", Address: address, City: "T", State: "NJ", Zip: "08034", "Seller First Name": "R", "Seller Last Name": "C", Phone: "", Email: "", "Reason For Selling": "", Motivation: "", "Time to Sell": "" };
    const result = await processRun(
      { tenantId: scope.tenantId, filename: "recall.xlsx", rows: [row], profile: GENERIC_PROFILE, rules, snapshotInput, year: 2026, colorCoding: false },
      { store, clock: () => "2026-07-08T12:00:00.000Z" },
    );
    return result.uploadRefId;
  }

  it("ING-09: voiding a held run removes its leads from partner + admin reads; still on the import page (TST-08)", async () => {
    const uploadRef = await processNjRun("9 Recall Rd");
    const partnerScope: ScopeContext = { tenantId: scope.tenantId, role: "partner", userId: randomUUID(), partnerId: partnerNJ };

    // The lead is HELD (just imported) — assigned, but not yet visible to the partner.
    expect((await listPartnerLeads(partnerScope)).total).toBe(0);
    const [up] = await db.select({ id: schema.uploads.id }).from(schema.uploads).where(and(eq(schema.uploads.tenantId, scope.tenantId), eq(schema.uploads.refId, uploadRef)));
    const [lead] = await db.select({ refId: schema.leads.refId }).from(schema.leads).where(and(eq(schema.leads.tenantId, scope.tenantId), eq(schema.leads.uploadId, up.id)));

    const voided = await voidUpload(scope, uploadRef, "recall it");
    expect(voided.recalledLeadCount).toBeGreaterThanOrEqual(1);

    // AFTER: soft-deleted ⇒ excluded from the admin per-run export deliverable (SEC-05).
    expect((await getRunExportData(scope, uploadRef))!.exportLeads.length).toBe(0);
    // …the partner still can't mutate it (soft-deleted → not found)…
    await expect(updateLeadStatus(partnerScope, lead.refId, "Contacted")).rejects.toBeInstanceOf(LeadNotFoundError);
    // …but it STILL shows in history on the import page (getRunDetail does not filter deleted_at).
    expect((await getRunDetail(scope, uploadRef))!.leads.length).toBeGreaterThanOrEqual(1);
  });

  it("distribution-hold: a released (distributed) run can no longer be voided (AlreadyDistributedError)", async () => {
    const uploadRef = await processNjRun("70 Released Ave");
    // Simulate the release cron having distributed it (still within the void window here).
    await db.update(schema.uploads).set({ distributedAt: new Date() }).where(and(eq(schema.uploads.tenantId, scope.tenantId), eq(schema.uploads.refId, uploadRef)));
    await expect(voidUpload(scope, uploadRef, "too late")).rejects.toBeInstanceOf(AlreadyDistributedError);
  });

  it("distribution-hold: only the latest non-voided import can be voided (NotLatestImportError)", async () => {
    const olderRef = await processNjRun("60 Older Ave");
    const newerRef = await processNjRun("61 Newer Ave"); // now the latest non-voided import
    // the older import is within its window but is no longer the latest → refused
    await expect(voidUpload(scope, olderRef, "too old")).rejects.toBeInstanceOf(NotLatestImportError);
    // the latest voids fine…
    await expect(voidUpload(scope, newerRef, "latest")).resolves.toBeTruthy();
    // …and now the older one is the latest non-voided ⇒ voidable again
    await expect(voidUpload(scope, olderRef, "now latest")).resolves.toBeTruthy();
  });

  it("ING-09/DM-09: a corrected re-upload of a voided run's address imports cleanly (ADR-0038: no unique key)", async () => {
    await voidUpload(scope, await processNjRun("77 Reupload Way"), "wrong file"); // soft-deletes the lead
    // Re-processing the SAME address inserts a fresh live row — dedup collapse and the
    // unique dedupe index were retired (ADR-0038), so nothing can collide.
    await expect(processNjRun("77 Reupload Way")).resolves.toBeTruthy();
  });

  it("WP-GL-B: voiding redacts the run's leads' seller PII + notes + task titles immediately (DM-09/LGL-02/SEC-05)", async () => {
    const uploadRef = await processNjRun("88 Purge Blvd");
    const [up] = await db
      .select({ id: schema.uploads.id })
      .from(schema.uploads)
      .where(and(eq(schema.uploads.tenantId, scope.tenantId), eq(schema.uploads.refId, uploadRef)));
    const [lead] = await db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, scope.tenantId), eq(schema.leads.uploadId, up.id)));
    // A note carrying seller PII on the lead.
    const author = randomUUID();
    await db.insert(schema.users).values({ id: author, tenantId: scope.tenantId, email: `purge-${author}@test.dev`, role: "admin" });
    await db.insert(schema.leadNotes).values({ tenantId: scope.tenantId, leadId: lead.id, authorUserId: author, authorRole: "admin", body: "seller Bob at 555-000-1234" });
    // WP-TSK-2 (audit F-5): a task title is the same human-typed free text on the same lead.
    await db.insert(schema.leadTasks).values({ tenantId: scope.tenantId, leadId: lead.id, authorUserId: author, authorRole: "admin", title: "call Bob on 555-000-1234" });

    await voidUpload(scope, uploadRef, "wrong file");

    const [l] = await db.select().from(schema.leads).where(eq(schema.leads.id, lead.id));
    expect(l.deletedAt).not.toBeNull();
    expect(l.piiPurgedAt).not.toBeNull();
    expect(l.sellerFirst).toBeNull();
    expect(l.address).toBeNull();
    expect(l.dedupeKey).toBe(REDACTED_DEDUPE_KEY);
    expect(l.rawJson).toEqual(REDACTED_RAW_JSON);
    const notes = await db.select().from(schema.leadNotes).where(eq(schema.leadNotes.leadId, lead.id));
    expect(notes[0].body).toBe(REDACTED_NOTE_BODY);
    const tasks = await db.select().from(schema.leadTasks).where(eq(schema.leadTasks.leadId, lead.id));
    expect(tasks[0].title).toBe(REDACTED_TASK_TITLE);
    // DM-04: the void audit records the purge count.
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, scope.tenantId), eq(schema.auditLog.action, "upload.voided"), eq(schema.auditLog.entityRef, uploadRef)));
    expect((audit.after as { piiPurged: number }).piiPurged).toBeGreaterThanOrEqual(1);
  });
});
