import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import type { ScopeContext } from "@/lib/scope";
import { listLeadNotes, addLeadNote, editLeadNote, LeadNotFoundError, NoteNotFoundError } from "@/modules/notes/notes";
import { releaseTenantLeads } from "../helpers/hold";
import { REDACTED } from "@/modules/audit/redact";

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
    // WP-NF2 NTF-11: a PARTNER note now writes a `partner_note` notification for every
    // admin-tier seat, which FKs `users`. Must go before the users delete.
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
    await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.tenantId, tids));
    await db.delete(schema.notificationPrefOverrides).where(inArray(schema.notificationPrefOverrides.tenantId, tids));
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
    id.pyUser = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@notes.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@notes.test", role: "partner", partnerId: px.id });
    await db.insert(schema.users).values({ id: id.pyUser, tenantId: t.id, email: "py@notes.test", role: "partner", partnerId: py.id });
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
  const partnerY = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pyUser, partnerId: id.py });

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

  it("NTS-02 / SEC-05: a note edit is audited, but the body is redacted — never the raw text", async () => {
    const { id: noteId } = await addLeadNote(partnerX(), "LD-26-00001", "first draft");
    await editLeadNote(partnerX(), noteId, "revised text");
    // The real bodies live on lead_notes (subject to the retention sweep), not the audit trail.
    const bodies = (await listLeadNotes(partnerX(), "LD-26-00001")).map((n) => n.body);
    expect(bodies).toContain("revised text");
    expect(bodies).not.toContain("first draft");

    const audits = await db
      .select({ action: schema.auditLog.action, before: schema.auditLog.before, after: schema.auditLog.after })
      .from(schema.auditLog)
      .where(inArray(schema.auditLog.tenantId, [id.tenant]));
    const edit = audits.find((a) => a.action === "note.edited");
    expect(edit, "the edit is still audited (DM-04)").toBeTruthy();
    // SEC-05 (ADR-0031): the append-only trail records that the body changed, masked.
    expect((edit!.before as { body: string }).body).toBe(REDACTED);
    expect((edit!.after as { body: string }).body).toBe(REDACTED);
    // No raw note text leaks into audit_log anywhere in the payload.
    const payload = JSON.stringify({ before: edit!.before, after: edit!.after });
    expect(payload).not.toContain("first draft");
    expect(payload).not.toContain("revised text");
  });

  it("a partner cannot edit an admin note (cross-stream)", async () => {
    const { id: adminNoteId } = await addLeadNote(admin(), "LD-26-00001", "admin private");
    await expect(editLeadNote(partnerX(), adminNoteId, "hacked")).rejects.toThrow();
  });

  it("TST-08/PRN-08: a lead re-routed from X to Y does not expose X's partner notes to Y", async () => {
    const { id: xNoteId } = await addLeadNote(partnerX(), "LD-26-00001", "X-PRIVATE seller intel");
    id.xNote = xNoteId;
    // Admin re-routes the lead to partner Y (manual overlay = the effective owner moves,
    // same ownership change editLead action "set" performs).
    await db.update(schema.leads).set({ manualPartnerId: id.py }).where(eq(schema.leads.refId, "LD-26-00001"));

    // Y now owns the lead but sees NONE of X's notes — a note belongs to the org that wrote it.
    const yBodies = (await listLeadNotes(partnerY(), "LD-26-00001")).map((n) => n.body);
    expect(yBodies).not.toContain("X-PRIVATE seller intel");
    expect(yBodies).toHaveLength(0);

    // Y's own stream still works on the re-routed lead (the predicate is not over-broad).
    await addLeadNote(partnerY(), "LD-26-00001", "Y note after re-route");
    const yAfter = (await listLeadNotes(partnerY(), "LD-26-00001")).map((n) => n.body);
    expect(yAfter).toContain("Y note after re-route");
    expect(yAfter).not.toContain("X-PRIVATE seller intel");

    // X lost the lead itself with the re-route (partnerOwnsLead revokes access).
    await expect(listLeadNotes(partnerX(), "LD-26-00001")).rejects.toBeInstanceOf(LeadNotFoundError);
  });

  it("TST-08/PRN-08: Y cannot edit X's note on a re-routed lead (editLeadNote mirror)", async () => {
    // Lead LD-26-00001 is Y's from the previous case; X's note id was captured there.
    await expect(editLeadNote(partnerY(), id.xNote, "hijacked")).rejects.toBeInstanceOf(NoteNotFoundError);
    // The note body is untouched: admin (full stream owner-side check) can't verify partner
    // notes (PRN-13), so assert straight from the table.
    const [row] = await db.select({ body: schema.leadNotes.body }).from(schema.leadNotes).where(eq(schema.leadNotes.id, id.xNote));
    expect(row.body).toBe("X-PRIVATE seller intel");
  });
});
