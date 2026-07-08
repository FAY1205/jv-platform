import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { listPartnerLeads, getPartnerLeadDetail } from "@/modules/portal/queries";
import { updateLeadStatus, LeadNotFoundError } from "@/modules/portal/status-update";

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
    await db.delete(schema.events).where(inArray(schema.events.tenantId, tids));
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
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@portal.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@portal.test", role: "partner", partnerId: px.id });

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "UP-2026-001", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-2026-00001", uploadId: up.id, dedupeKey: "x|1", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "Xavier", sellerLast: "X" });
    await db.insert(schema.leads).values({ tenantId: t.id, refId: "LD-2026-00002", uploadId: up.id, dedupeKey: "y|2", rawJson: {}, partnerId: py.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "Yolanda", sellerLast: "Y" });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const adminA = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminUser });
  const partnerX = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });

  it("PTL-02: a partner sees only their own leads", async () => {
    const page = await listPartnerLeads(partnerX());
    const refs = page.leads.map((l) => l.refId);
    expect(refs).toContain("LD-2026-00001");
    expect(refs).not.toContain("LD-2026-00002");
    expect(page.total).toBe(1);
  });

  it("PTL-03: a partner updates their own lead → status history + current status", async () => {
    await updateLeadStatus(partnerX(), "LD-2026-00001", "Contacted");
    const detail = await getPartnerLeadDetail(partnerX(), "LD-2026-00001");
    expect(detail?.status).toBe("Contacted");
    expect(detail?.history[0]?.status).toBe("Contacted");
  });

  it("a partner cannot update a lead that isn't theirs", async () => {
    await expect(updateLeadStatus(partnerX(), "LD-2026-00002", "Contacted")).rejects.toBeInstanceOf(LeadNotFoundError);
  });

  it("PTL-03: the admin sees the partner's status change", async () => {
    const detail = await getPartnerLeadDetail(adminA(), "LD-2026-00001");
    expect(detail?.status).toBe("Contacted");
  });
});
