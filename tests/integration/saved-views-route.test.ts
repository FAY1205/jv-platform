import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { APP_ORIGIN, adminScope, jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";

// getServerScope is injected at its module seam so the routes run as a real caller without a
// live Supabase session (see _route-harness). CSRF, the Zod contracts, the commands and the DB
// all stay real — this suite covers the ROUTES' own contract: status codes, the uniform
// {code,message,traceId} envelope, the SV-02 admin gate, the narrowed duplicate-name 409, and
// the fact that no body can choose whose view it is.
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { GET as listRoute, POST as createRoute } from "@/app/api/saved-views/route";
import { PATCH as patchRoute, DELETE as deleteRoute } from "@/app/api/saved-views/[id]/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-route-saved-views";

suite("WP-SV-1: saved-view route contract (status + error envelope + admin gate)", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  const adminUserId = randomUUID();
  const otherAdminUserId = randomUUID();
  const partnerUserId = randomUUID();
  let partnerId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.savedViews).where(inArray(schema.savedViews.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Route Views", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    const [p] = await db
      .insert(schema.partners)
      .values({ tenantId, refId: "JV-931", name: "Route Partner", color: "#123456", status: "active" })
      .returning({ id: schema.partners.id });
    partnerId = p.id;
    await db.insert(schema.users).values([
      { id: adminUserId, tenantId, email: "admin@route-views.test", role: "admin" as const },
      { id: otherAdminUserId, tenantId, email: "admin2@route-views.test", role: "admin" as const },
      { id: partnerUserId, tenantId, email: "px@route-views.test", role: "partner" as const, partnerId: p.id },
    ]);
    setRouteScope(adminScope(tenantId, adminUserId));
  });

  afterAll(async () => {
    setRouteScope(null);
    await cleanup();
  });

  const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

  async function createOk(name: string, filters: Record<string, unknown> = {}): Promise<string> {
    const res = await createRoute(jsonRequest("POST", "/api/saved-views", { name, filters }));
    expect(res.status).toBe(200);
    return (await body(res)).id as string;
  }

  it("SV-02: POST saves the current filters and GET lists them back", async () => {
    const id = await createOk("Hot in AZ", { hot: true, state: "az", viewMode: "board" });
    const listed = await listRoute();
    expect(listed.status).toBe(200);
    const views = (await body(listed)).views as { id: string; name: string; filters: Record<string, unknown> }[];
    const mine = views.find((v) => v.id === id);
    expect(mine).toMatchObject({ name: "Hot in AZ" });
    expect(mine!.filters).toMatchObject({ hot: true, state: "AZ", viewMode: "board" });
  });

  it("SV-01: a duplicate name is 409 duplicate_view with the uniform envelope", async () => {
    await createOk("Route Unique");
    const dup = await createRoute(jsonRequest("POST", "/api/saved-views", { name: "ROUTE unique", filters: {} }));
    expect(dup.status).toBe(409);
    const env = await body(dup);
    expect(env.code).toBe("duplicate_view");
    expect(env.traceId).toEqual(expect.any(String));
  });

  it("SV-03: PATCH is the overwrite path (same id) and DELETE removes the view", async () => {
    const id = await createOk("Route Overwrite", { hot: false });
    const patched = await patchRoute(
      jsonRequest("PATCH", `/api/saved-views/${id}`, { filters: { hot: true, statuses: "New" } }),
      routeParams({ id }),
    );
    expect(patched.status).toBe(200);
    const [row] = await db.select({ filters: schema.savedViews.filters }).from(schema.savedViews).where(eq(schema.savedViews.id, id));
    expect(row.filters).toMatchObject({ hot: true, statuses: ["New"] });

    expect((await deleteRoute(jsonRequest("DELETE", `/api/saved-views/${id}`), routeParams({ id }))).status).toBe(200);
    const gone = await deleteRoute(jsonRequest("DELETE", `/api/saved-views/${id}`), routeParams({ id }));
    expect(gone.status).toBe(404);
    expect((await body(gone)).code).toBe("not_found");
  });

  it("SV-02: a body can NEVER choose whose view it is (a smuggled user_id is a 400)", async () => {
    for (const payload of [
      { name: "Smuggled", filters: {}, userId: otherAdminUserId },
      { name: "Smuggled", filters: {}, user_id: otherAdminUserId },
      { name: "Smuggled", filters: {}, tenantId: randomUUID() },
      { name: "Smuggled", filters: { userId: otherAdminUserId } }, // …and not inside the blob either
    ]) {
      const res = await createRoute(jsonRequest("POST", "/api/saved-views", payload));
      if (res.status === 200) {
        // The last payload is legal (unknown blob keys are STRIPPED, not rejected) — so assert
        // the stored row is still the CALLER's, which is the property under test.
        const [row] = await db
          .select({ userId: schema.savedViews.userId, filters: schema.savedViews.filters })
          .from(schema.savedViews)
          .where(eq(schema.savedViews.id, (await body(res)).id as string));
        expect(row.userId).toBe(adminUserId);
        expect(JSON.stringify(row.filters)).not.toContain(otherAdminUserId);
      } else {
        expect(res.status, JSON.stringify(payload)).toBe(400);
        expect((await body(res)).code).toBe("invalid_input");
      }
    }
    // Nothing landed in the other admin's menu.
    const theirs = await db.select({ id: schema.savedViews.id }).from(schema.savedViews).where(eq(schema.savedViews.userId, otherAdminUserId));
    expect(theirs).toHaveLength(0);
  });

  it("SV-02/SCP-01: another admin's view is a 404 over HTTP — the boundary never reports itself", async () => {
    // A REAL row, same tenant, different owner (the only oracle for the user column).
    const [theirs] = await db
      .insert(schema.savedViews)
      .values({ tenantId, userId: otherAdminUserId, name: "Their view", filters: {} })
      .returning({ id: schema.savedViews.id });

    const patched = await patchRoute(jsonRequest("PATCH", `/api/saved-views/${theirs.id}`, { name: "stolen" }), routeParams({ id: theirs.id }));
    expect(patched.status).toBe(404);
    const removed = await deleteRoute(jsonRequest("DELETE", `/api/saved-views/${theirs.id}`), routeParams({ id: theirs.id }));
    expect(removed.status).toBe(404);

    // …and it never appears in the caller's list, nor was it touched.
    const views = (await body(await listRoute())).views as { id: string }[];
    expect(views.map((v) => v.id)).not.toContain(theirs.id);
    const [still] = await db.select({ name: schema.savedViews.name }).from(schema.savedViews).where(eq(schema.savedViews.id, theirs.id));
    expect(still.name).toBe("Their view");
  });

  it("Zod-validates every body (missing/over-long name, non-object blob, empty patch, bad id)", async () => {
    const badCreates = [
      {},
      { name: "no filters" },
      { name: "   ", filters: {} },
      { name: "x".repeat(61), filters: {} },
      { name: "bad blob", filters: "everything" },
      { name: "bad blob", filters: [] },
      { name: "ok", filters: {}, nmae: "typo" },
    ];
    for (const payload of badCreates) {
      const res = await createRoute(jsonRequest("POST", "/api/saved-views", payload));
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect((await body(res)).code).toBe("invalid_input");
    }
    const someId = randomUUID();
    const emptyPatch = await patchRoute(jsonRequest("PATCH", `/api/saved-views/${someId}`, {}), routeParams({ id: someId }));
    expect(emptyPatch.status).toBe(400);
    expect((await body(emptyPatch)).code).toBe("invalid_input");

    const badId = await patchRoute(jsonRequest("PATCH", "/api/saved-views/not-a-uuid", { name: "x" }), routeParams({ id: "not-a-uuid" }));
    expect(badId.status).toBe(400);
    expect((await body(badId)).code).toBe("invalid_id");
  });

  it("SV-02: a PARTNER session gets 403 on EVERY saved-view route", async () => {
    const id = await createOk("Route Admin Only");
    const partner: ScopeContext = { tenantId, role: "partner", userId: partnerUserId, partnerId };
    setRouteScope(partner);
    try {
      const calls: [string, Promise<Response>][] = [
        ["GET /api/saved-views", listRoute()],
        ["POST /api/saved-views", createRoute(jsonRequest("POST", "/api/saved-views", { name: "partner view", filters: {} }))],
        ["PATCH /api/saved-views/[id]", patchRoute(jsonRequest("PATCH", `/api/saved-views/${id}`, { name: "x" }), routeParams({ id }))],
        ["DELETE /api/saved-views/[id]", deleteRoute(jsonRequest("DELETE", `/api/saved-views/${id}`), routeParams({ id }))],
      ];
      for (const [label, p] of calls) {
        const res = await p;
        expect(res.status, label).toBe(403);
        expect((await body(res)).code, label).toBe("forbidden");
      }
      // …and nothing the partner sent took effect.
      const [still] = await db.select({ name: schema.savedViews.name }).from(schema.savedViews).where(eq(schema.savedViews.id, id));
      expect(still.name).toBe("Route Admin Only");
      const partnerRows = await db.select({ id: schema.savedViews.id }).from(schema.savedViews).where(eq(schema.savedViews.userId, partnerUserId));
      expect(partnerRows).toHaveLength(0);
    } finally {
      setRouteScope(adminScope(tenantId, adminUserId));
    }
  });

  it("AUT-12: a mutating request without the CSRF pair is rejected with 403 csrf_rejected", async () => {
    const naked = new Request(`${APP_ORIGIN}/api/saved-views`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "no csrf", filters: {} }),
    });
    const res = await createRoute(naked);
    expect(res.status).toBe(403);
    expect((await body(res)).code).toBe("csrf_rejected");
  });

  it("returns 401 when there is no session", async () => {
    setRouteScope(null);
    try {
      const res = await listRoute();
      expect(res.status).toBe(401);
      expect((await body(res)).code).toBe("unauthenticated");
    } finally {
      setRouteScope(adminScope(tenantId, adminUserId));
    }
  });
});
