import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { listPartnerLeads, getPartnerLeadDetail, getPartnerExportData } from "@/modules/portal/queries";
import { updateLeadStatus, LeadNotFoundError, LeadRemovedError } from "@/modules/portal/status-update";
import { releaseTenantLeads } from "../helpers/hold";

// TST-08 (live): partner portal scoping. A partner sees ONLY their own leads and can
// only update their own leads' status; the admin sees the change. Self-skips w/o DB.
// NOTE: these modules use the singleton getDb() (env DATABASE_URL), so run with
// node --env-file=.env.local. The suite seeds/cleans its own isolated tenant.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-portal-iso";

suite("TST-08: partner portal scoping", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
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

    const [t] = await db.insert(schema.tenants).values({ name: "Portal Iso", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222222", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.py = py.id;

    id.adminUser = randomUUID();
    id.pxUser = randomUUID();
    id.pyUser = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@portal.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@portal.test", role: "partner", partnerId: px.id });
    await db.insert(schema.users).values({ id: id.pyUser, tenantId: t.id, email: "py@portal.test", role: "partner", partnerId: py.id });

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-001", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-26-00001", uploadId: up.id, dedupeKey: "x|1", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "Xavier", sellerLast: "X", campaign: "Secret Lead Source A" });
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-26-00002", uploadId: up.id, dedupeKey: "y|2", rawJson: {}, partnerId: py.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "Yolanda", sellerLast: "Y" });
    // A removed lead — its status is the read-only "Removed MLS" verdict; workflow
    // status changes must be refused (PRN-04 keeps MLS state authoritative).
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-26-00003", uploadId: up.id, dedupeKey: "z|3", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "removed", sellerFirst: "Zed", sellerLast: "Z" });
    // Release the seeded leads past the distribution hold so the partner can see/act on them.
    await releaseTenantLeads(db, id.tenant);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const adminA = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminUser });
  const partnerX = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });
  const partnerY = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pyUser, partnerId: id.py });

  it("PTL-02: a partner sees only their own leads", async () => {
    const page = await listPartnerLeads(partnerX());
    const refs = page.leads.map((l) => l.refId);
    expect(refs).toContain("LD-26-00001");
    expect(refs).not.toContain("LD-26-00002");
    expect(page.total).toBe(1);
  });

  it("PTL-03: a partner updates their own lead → status history + current status", async () => {
    await updateLeadStatus(partnerX(), "LD-26-00001", "Contacted");
    const detail = await getPartnerLeadDetail(partnerX(), "LD-26-00001");
    expect(detail?.status).toBe("Contacted");
    expect(detail?.history[0]?.status).toBe("Contacted");
  });

  it("a partner cannot update a lead that isn't theirs", async () => {
    await expect(updateLeadStatus(partnerX(), "LD-26-00002", "Contacted")).rejects.toBeInstanceOf(LeadNotFoundError);
  });

  it("PTL-03: the admin sees the partner's status change", async () => {
    const detail = await getPartnerLeadDetail(adminA(), "LD-26-00001");
    expect(detail?.status).toBe("Contacted");
  });

  it("PRN-04: a workflow status change on an MLS-removed lead is refused", async () => {
    await expect(updateLeadStatus(adminA(), "LD-26-00003", "Contacted")).rejects.toBeInstanceOf(LeadRemovedError);
  });

  it("distribution hold: a fresh lead is held (invisible to the partner) until released; admin sees it throughout", async () => {
    const [up] = await db.insert(schema.uploads).values({ tenantId: id.tenant, refId: "IM-26-002", filename: "h.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({ tenantId: id.tenant, refId: "LD-26-00099", uploadId: up.id, dedupeKey: "held|99", rawJson: {}, partnerId: id.px, matchMethod: "zip", mlsStatus: "kept" }); // fresh ⇒ held
    // HELD: invisible to the partner…
    expect((await listPartnerLeads(partnerX())).leads.some((l) => l.refId === "LD-26-00099")).toBe(false);
    expect(await getPartnerLeadDetail(partnerX(), "LD-26-00099")).toBeNull();
    // …but the admin sees it immediately (the gate is partner-only).
    expect((await getPartnerLeadDetail(adminA(), "LD-26-00099"))?.refId).toBe("LD-26-00099");
    // RELEASED (past the window): now visible to the partner.
    await db.update(schema.leads).set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) }).where(eq(schema.leads.refId, "LD-26-00099"));
    expect((await listPartnerLeads(partnerX())).leads.some((l) => l.refId === "LD-26-00099")).toBe(true);
    expect((await getPartnerLeadDetail(partnerX(), "LD-26-00099"))?.refId).toBe("LD-26-00099");
  });

  it("PTL-04/PRN-08: the portal export never carries the lead source (Campaign) and fetches only the caller's own partner row", async () => {
    const data = await getPartnerExportData(partnerX());
    // Only the partner's own leads, and every campaign value blanked — the lead
    // source is admin-only; the portal UI/API already omit it, the export must too.
    expect(data.exportLeads.length).toBeGreaterThan(0);
    expect(data.exportLeads.every((l) => l.campaign === "")).toBe(true);
    // No sibling-partner identities in the partners map (PRN-08 discipline).
    expect([...data.partners.keys()]).toEqual([id.px]);
  });

  it("F-12: re-setting the current status is a no-op (changed:false, no new history, so the route skips notify)", async () => {
    const [lead] = await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.refId, "LD-26-00001"));
    const first = await updateLeadStatus(adminA(), "LD-26-00001", "Appointment"); // a real change
    expect(first.changed).toBe(true);
    const h1 = await db.select({ id: schema.leadStatusHistory.id }).from(schema.leadStatusHistory).where(eq(schema.leadStatusHistory.leadId, lead.id));
    const second = await updateLeadStatus(adminA(), "LD-26-00001", "Appointment"); // same status again → no-op
    // changed:false is the seam the portal route gates its admin notification on (F-1).
    expect(second.changed).toBe(false);
    const h2 = await db.select({ id: schema.leadStatusHistory.id }).from(schema.leadStatusHistory).where(eq(schema.leadStatusHistory.leadId, lead.id));
    expect(h2.length).toBe(h1.length);
  });

  // A dedicated PX-owned lead, released past the distribution hold so both partners can act on it.
  async function seedReroutableLead(ref: string, dedupe: string) {
    const [up] = await db.insert(schema.uploads).values({ tenantId: id.tenant, refId: `IM-RR-${dedupe}`, filename: "rr.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({
      tenantId: id.tenant, refId: ref, uploadId: up.id, dedupeKey: `reroute|${dedupe}`, rawJson: {},
      partnerId: id.px, matchMethod: "zip", mlsStatus: "kept",
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
    });
  }

  it("R-22/TST-08: a lead re-routed X→Y does not carry X's status timeline to Y (partner sees only its own org's entries)", async () => {
    await seedReroutableLead("LD-26-00050", "50");
    // PX advances the lead → an X-authored status-history row.
    await updateLeadStatus(partnerX(), "LD-26-00050", "Contacted");
    // Admin re-routes to PY (manual overlay = the effective owner moves — the ownership
    // change editLead action "set" performs). PRN-05: historical assignments untouched.
    await db.update(schema.leads).set({ manualPartnerId: id.py }).where(eq(schema.leads.refId, "LD-26-00050"));

    // PY now owns the lead but inherits NONE of X's timeline: empty history, reset to New.
    const detailY = await getPartnerLeadDetail(partnerY(), "LD-26-00050");
    expect(detailY?.history).toHaveLength(0);
    expect(detailY?.status).toBe("New");

    // The list agrees with the detail — statusMap AND the raw latest-status subquery are both
    // author-scoped, so PY's row reads "New": a New filter includes it, a Contacted filter never
    // surfaces X's status (a partner must not even infer the prior owner's status via the filter).
    expect((await listPartnerLeads(partnerY(), { statuses: ["New"] })).leads.some((l) => l.refId === "LD-26-00050")).toBe(true);
    expect((await listPartnerLeads(partnerY(), { statuses: ["Contacted"] })).leads.some((l) => l.refId === "LD-26-00050")).toBe(false);

    // The admin still sees the WHOLE timeline (admin reads are unscoped).
    const detailAdmin = await getPartnerLeadDetail(adminA(), "LD-26-00050");
    expect(detailAdmin?.history.map((h) => h.status)).toEqual(["Contacted"]);
  });

  it("R-22/R-26: after re-route, PY re-setting the status X had used is a REAL change for PY, not a no-op (the current-status the update transitions from is PY's own)", async () => {
    await seedReroutableLead("LD-26-00051", "51");
    await updateLeadStatus(partnerX(), "LD-26-00051", "Contacted"); // X-authored
    await db.update(schema.leads).set({ manualPartnerId: id.py }).where(eq(schema.leads.refId, "LD-26-00051"));

    // PY sees "New", so setting "Contacted" is a genuine New→Contacted transition for PY — it must
    // append a Y-authored row (changed:true), NOT collapse to a no-op against X's global latest.
    const res = await updateLeadStatus(partnerY(), "LD-26-00051", "Contacted");
    expect(res.changed).toBe(true);

    const detailY = await getPartnerLeadDetail(partnerY(), "LD-26-00051");
    expect(detailY?.status).toBe("Contacted");
    expect(detailY?.history.map((h) => h.status)).toEqual(["Contacted"]); // only PY's entry, never X's

    // Admin sees both partners' entries (two "Contacted" rows, newest first).
    const detailAdmin = await getPartnerLeadDetail(adminA(), "LD-26-00051");
    expect(detailAdmin?.history.map((h) => h.status)).toEqual(["Contacted", "Contacted"]);
  });

  it("R-22 (owner 2026-08-07): a partner DOES see an ADMIN's status change on their own (never re-routed) lead; re-setting the same value is a no-op", async () => {
    await seedReroutableLead("LD-26-00052", "52"); // owned by PX, never re-routed
    // The admin changes the status from the admin Leads table → an admin-authored history row.
    await updateLeadStatus(adminA(), "LD-26-00052", "Appointment");

    // Option B: admin (and own-org) entries stay visible to the owning partner — only ANOTHER
    // partner's entries are hidden. So PX sees the admin's change, not a stale "New".
    const detailX = await getPartnerLeadDetail(partnerX(), "LD-26-00052");
    expect(detailX?.status).toBe("Appointment");
    expect(detailX?.history.map((h) => h.status)).toEqual(["Appointment"]);

    // The write-path idempotency read is author-scoped the same way, so it sees the admin entry too:
    // PX re-setting the same value is a genuine no-op (no duplicate row, no spurious notification).
    const res = await updateLeadStatus(partnerX(), "LD-26-00052", "Appointment");
    expect(res.changed).toBe(false);
  });
});
