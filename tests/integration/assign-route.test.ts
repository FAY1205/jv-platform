import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import type * as ScopeContextModule from "@/lib/scope-context";
import { adminScope, jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";

// getServerScope is injected at its module seam so the route runs as an admin without
// a live Supabase session (see _route-harness). CSRF, Zod, manuallyAssignLead, the F-40
// notify wiring, and the DB all stay real. Covers the route's success path + the F-40
// partner notification the assign route enqueues (the direct notifyLeadAssigned unit is
// in assign-notify.test.ts; this proves the ROUTE actually calls it).
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { POST } from "@/app/api/leads/[ref]/assign/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-route-assign-ws9";

suite("POST /api/leads/[ref]/assign — F-40 partner notification wiring", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  let partnerId: string;
  let partnerUserId: string;
  const UNMATCHED_REF = "LD-26-91001";

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Route-Assign", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    const [p] = await db.insert(schema.partners).values({ tenantId, refId: "JV-911", name: "Assignee", color: "#334455", status: "active" }).returning({ id: schema.partners.id });
    partnerId = p.id;
    partnerUserId = randomUUID();
    await db.insert(schema.users).values({ id: partnerUserId, tenantId, email: "assignee@route.test", role: "partner", partnerId: p.id });
    const [u] = await db.insert(schema.uploads).values({ tenantId, refId: "IM-26-911", filename: "leads.csv", status: "processed" }).returning({ id: schema.uploads.id });
    // Unmatched: kept, no snapshot owner, no overlay — the only state manuallyAssignLead accepts.
    await db.insert(schema.leads).values({ tenantId, refId: UNMATCHED_REF, uploadId: u.id, dedupeKey: randomUUID(), rawJson: {}, mlsStatus: "kept", matchMethod: "none", partnerId: null, manualPartnerId: null });
    setRouteScope(adminScope(tenantId));
  });

  afterAll(async () => {
    setRouteScope(null);
    await cleanup();
  });

  it("F-40: assigning an unmatched lead succeeds and notifies the receiving partner", async () => {
    const req = jsonRequest("POST", `/api/leads/${UNMATCHED_REF}/assign`, { partnerId });
    const res = await POST(req, routeParams({ ref: UNMATCHED_REF }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("ok");

    const notifs = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, tenantId), eq(schema.notifications.userId, partnerUserId)));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("assigned_lead");
    expect(notifs[0].deepLink).toBe(`/portal/leads/${UNMATCHED_REF}`);
  });
});
