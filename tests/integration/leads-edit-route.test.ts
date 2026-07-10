import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import type * as ScopeContextModule from "@/lib/scope-context";
import { adminScope, jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";

// getServerScope is injected at its module seam so the route runs as an admin
// without a live Supabase session (see _route-harness). CSRF, the Zod contract,
// editLead, and the DB all stay real — this suite covers the route's own
// error→HTTP-status mapping, which the command/schema unit + integration tests
// (which call editLead / EditLeadSchema directly) never exercise.
vi.mock("@/lib/scope-context", async (orig) =>
  scopeContextMock(await orig<typeof ScopeContextModule>()),
);

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { PATCH } from "@/app/api/leads/[ref]/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-route-leads-edit";

suite("PATCH /api/leads/[ref] — route error mapping (ADM)", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  let routedPartnerId: string;
  const ROUTED_REF = "LD-26-90001"; // pipeline-routed lead (snapshot owner set)

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    // FK-safe order: audit + leads reference partners/uploads/tenant.
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Route-Edit", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    const [p] = await db
      .insert(schema.partners)
      .values({ tenantId, refId: "JV-901", name: "Routed Partner", color: "#123456", status: "active" })
      .returning({ id: schema.partners.id });
    routedPartnerId = p.id;
    const [u] = await db
      .insert(schema.uploads)
      .values({ tenantId, refId: "IM-26-901", filename: "leads.csv", status: "processed" })
      .returning({ id: schema.uploads.id });
    // Pipeline-routed: the immutable snapshot routed this lead to a partner
    // (partnerId set, matchMethod "zip") and there is NO manual overlay.
    await db.insert(schema.leads).values({
      tenantId,
      refId: ROUTED_REF,
      uploadId: u.id,
      dedupeKey: randomUUID(),
      rawJson: {},
      mlsStatus: "kept",
      matchMethod: "zip",
      partnerId: routedPartnerId,
      manualPartnerId: null,
    });
    setRouteScope(adminScope(tenantId));
  });

  afterAll(async () => {
    setRouteScope(null);
    await cleanup();
  });

  it("PRN-05: unassigning a pipeline-routed lead returns the 409 cannot_unassign envelope", async () => {
    const req = jsonRequest("PATCH", `/api/leads/${ROUTED_REF}`, { partner: { action: "unassign" } });
    const res = await PATCH(req, routeParams({ ref: ROUTED_REF }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("cannot_unassign");
    expect(typeof body.message).toBe("string");
    expect(typeof body.traceId).toBe("string"); // uniform error envelope
  });

  it("PRN-05: the rejected unassign leaves the immutable snapshot (partnerId/matchMethod) untouched", async () => {
    const [row] = await db
      .select({
        partnerId: schema.leads.partnerId,
        matchMethod: schema.leads.matchMethod,
        manualPartnerId: schema.leads.manualPartnerId,
      })
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), eq(schema.leads.refId, ROUTED_REF)));

    expect(row.partnerId).toBe(routedPartnerId);
    expect(row.matchMethod).toBe("zip");
    expect(row.manualPartnerId).toBeNull();
  });
});
