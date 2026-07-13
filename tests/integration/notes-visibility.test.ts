import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import type { ScopeContext } from "@/lib/scope";
import { listLeadNotes, addLeadNote, editLeadNote, LeadNotFoundError } from "@/modules/notes/notes";
import { releaseTenantLeads } from "../helpers/hold";

// TST-08 / PRN-13 (live): admin and partner note streams are mutually invisible.
// Self-skips without DATABASE_URL. Run with node --env-file=.env.local.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-notes-iso";

suite("PRN-13/NTS: two-stream note visibility", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leadNotes).where(inArray(schema.leadNotes.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Notes Iso", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.py = py.id;
    id.adminUser = randomUUID();
    id.pxUser = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@notes.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@notes.test", role: "partner", partnerId: px.id });
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-001", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-26-00001", uploadId: up.id, dedupeKey: "x|1", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept" });
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-26-00002", uploadId: up.id, dedupeKey: "y|2", rawJson: {}, partnerId: py.id, matchMethod: "zip", mlsStatus: "kept" });
    // Release the seeded leads past the distribution hold so the partner can note them.
    await releaseTenantLeads(db, id.tenant);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const admin = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminUser });
  const partnerX = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });

  it("PRN-13: admin sees only admin notes; partner sees only partner notes", async () => {
    await addLeadNote(admin(), "LD-26-00001", "ADMIN-ONLY note");
    await addLeadNote(partnerX(), "LD-26-00001", "PARTNER-ONLY note");

    const adminBodies = (await listLeadNotes(admin(), "LD-26-00001")).map((n) => n.body);
    expect(adminBodies).toContain("ADMIN-ONLY note");
    expect(adminBodies).not.toContain("PARTNER-ONLY note");

    const partnerBodies = (await listLeadNotes(partnerX(), "LD-26-00001")).map((n) => n.body);
    expect(partnerBodies).toContain("PARTNER-ONLY note");
    expect(partnerBodies).not.toContain("ADMIN-ONLY note");
  });

  it("a partner cannot add a note to a lead that isn't theirs", async () => {
    await expect(addLeadNote(partnerX(), "LD-26-00002", "sneaky")).rejects.toBeInstanceOf(LeadNotFoundError);
  });

  it("NTS-02: editing a note is audited (before/after)", async () => {
    const { id: noteId } = await addLeadNote(partnerX(), "LD-26-00001", "first draft");
    await editLeadNote(partnerX(), noteId, "revised text");
    const bodies = (await listLeadNotes(partnerX(), "LD-26-00001")).map((n) => n.body);
    expect(bodies).toContain("revised text");
    expect(bodies).not.toContain("first draft");
    const audits = await db
      .select({ action: schema.auditLog.action, before: schema.auditLog.before, after: schema.auditLog.after })
      .from(schema.auditLog)
      .where(inArray(schema.auditLog.tenantId, [id.tenant]));
    const edit = audits.find((a) => a.action === "note.edited");
    expect(edit).toBeTruthy();
    expect((edit!.before as { body: string }).body).toBe("first draft");
    expect((edit!.after as { body: string }).body).toBe("revised text");
  });

  it("a partner cannot edit an admin note (cross-stream)", async () => {
    const { id: adminNoteId } = await addLeadNote(admin(), "LD-26-00001", "admin private");
    await expect(editLeadNote(partnerX(), adminNoteId, "hacked")).rejects.toThrow();
  });
});
