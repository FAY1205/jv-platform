import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { purgeAuditLog } from "../helpers/audit";
import type * as ScopeContextModule from "@/lib/scope-context";
import { APP_ORIGIN, adminScope, jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";

// getServerScope is injected at its module seam so the routes run as a real caller without a
// live Supabase session (see _route-harness). CSRF, the Zod contracts, the tag commands and
// the DB all stay real — this suite covers the ROUTES' own contract: status codes, the
// uniform {code,message,traceId} envelope, and the TAG-02 admin gate on every one of them.
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { GET as listTagsRoute, POST as createTagRoute } from "@/app/api/tags/route";
import { PATCH as patchTagRoute, DELETE as deleteTagRoute } from "@/app/api/tags/[id]/route";
import { GET as leadTagsRoute, POST as attachRoute } from "@/app/api/leads/[ref]/tags/route";
import { DELETE as detachRoute } from "@/app/api/leads/[ref]/tags/[tagId]/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-route-tags";
const REF = "LD-26-92001";

suite("WP-TAG-1: tag route contract (status + error envelope + admin gate)", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  const adminUserId = randomUUID();
  const partnerUserId = randomUUID();
  let partnerId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leadTags).where(inArray(schema.leadTags.tenantId, tids));
    await db.delete(schema.tags).where(inArray(schema.tags.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Route Tags", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    const [p] = await db
      .insert(schema.partners)
      .values({ tenantId, refId: "JV-921", name: "Route Partner", color: "#123456", status: "active" })
      .returning({ id: schema.partners.id });
    partnerId = p.id;
    await db.insert(schema.users).values([
      { id: adminUserId, tenantId, email: "admin@route-tags.test", role: "admin" as const },
      { id: partnerUserId, tenantId, email: "px@route-tags.test", role: "partner" as const, partnerId: p.id },
    ]);
    const [u] = await db
      .insert(schema.uploads)
      .values({ tenantId, refId: "IM-26-921", filename: "leads.csv", status: "processed" })
      .returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({
      tenantId, refId: REF, uploadId: u.id, dedupeKey: randomUUID(), rawJson: {},
      mlsStatus: "kept", matchMethod: "zip", partnerId: p.id,
    });
    setRouteScope(adminScope(tenantId, adminUserId));
  });

  afterAll(async () => {
    setRouteScope(null);
    await cleanup();
  });

  const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

  async function createOk(name: string): Promise<string> {
    const res = await createTagRoute(jsonRequest("POST", "/api/tags", { name }));
    expect(res.status).toBe(200);
    return (await body(res)).id as string;
  }

  it("TAG-03: POST /api/tags creates, GET lists it with a usage count, POST attaches it", async () => {
    const id = await createOk("Route Probate");
    const listed = await listTagsRoute();
    expect(listed.status).toBe(200);
    const tags = (await body(listed)).tags as { id: string; name: string; color: string; leadCount: number }[];
    expect(tags.find((t) => t.id === id)).toMatchObject({ name: "Route Probate", leadCount: 0 });

    const attached = await attachRoute(jsonRequest("POST", `/api/leads/${REF}/tags`, { tagId: id }), routeParams({ ref: REF }));
    expect(attached.status).toBe(200);
    expect(await body(attached)).toEqual({ attached: true });

    const onLead = await leadTagsRoute(jsonRequest("GET", `/api/leads/${REF}/tags`), routeParams({ ref: REF }));
    expect(((await body(onLead)).tags as { id: string }[]).map((t) => t.id)).toEqual([id]);
  });

  it("TAG-03: attach/detach are idempotent over HTTP (200, not 409)", async () => {
    const id = await createOk("Route Idempotent");
    for (const expected of [true, false]) {
      const res = await attachRoute(jsonRequest("POST", `/api/leads/${REF}/tags`, { tagId: id }), routeParams({ ref: REF }));
      expect(res.status).toBe(200);
      expect((await body(res)).attached).toBe(expected);
    }
    for (const expected of [true, false]) {
      const res = await detachRoute(jsonRequest("DELETE", `/api/leads/${REF}/tags/${id}`), routeParams({ ref: REF, tagId: id }));
      expect(res.status).toBe(200);
      expect((await body(res)).detached).toBe(expected);
    }
  });

  it("TAG-01: a duplicate name is 409 duplicate_tag with the uniform envelope", async () => {
    await createOk("Route Unique");
    const dup = await createTagRoute(jsonRequest("POST", "/api/tags", { name: "route unique" }));
    expect(dup.status).toBe(409);
    const env = await body(dup);
    expect(env.code).toBe("duplicate_tag");
    expect(env.traceId).toEqual(expect.any(String));
  });

  it("Zod-validates every body (empty/over-long name, off-palette color, unknown key, bad tag id)", async () => {
    const badCreates = [
      {},
      { name: "   " },
      { name: "x".repeat(41) },
      { name: "ok", color: "#ff0000" }, // hex is not a palette key
      { name: "ok", color: "chartreuse" },
      { name: "ok", nmae: "typo" }, // strict object
    ];
    for (const payload of badCreates) {
      const res = await createTagRoute(jsonRequest("POST", "/api/tags", payload));
      expect(res.status, `payload ${JSON.stringify(payload)}`).toBe(400);
      expect((await body(res)).code).toBe("invalid_input");
    }
    const emptyPatch = await patchTagRoute(jsonRequest("PATCH", `/api/tags/${randomUUID()}`, {}), routeParams({ id: randomUUID() }));
    expect(emptyPatch.status).toBe(400);
    const badAttach = await attachRoute(jsonRequest("POST", `/api/leads/${REF}/tags`, { tagId: "nope" }), routeParams({ ref: REF }));
    expect(badAttach.status).toBe(400);
    expect((await body(badAttach)).code).toBe("invalid_input");
  });

  it("rejects malformed ids/refs (400) and unknown ones (404)", async () => {
    const badId = await patchTagRoute(jsonRequest("PATCH", "/api/tags/not-a-uuid", { name: "x" }), routeParams({ id: "not-a-uuid" }));
    expect(badId.status).toBe(400);
    expect((await body(badId)).code).toBe("invalid_id");

    const badRef = await leadTagsRoute(jsonRequest("GET", "/api/leads/nope/tags"), routeParams({ ref: "nope" }));
    expect(badRef.status).toBe(400);
    expect((await body(badRef)).code).toBe("invalid_ref");

    const unknown = randomUUID();
    const missing = await deleteTagRoute(jsonRequest("DELETE", `/api/tags/${unknown}`), routeParams({ id: unknown }));
    expect(missing.status).toBe(404);
    const env = await body(missing);
    expect(env.code).toBe("not_found");
    expect(env.traceId).toEqual(expect.any(String));
  });

  it("TAG-06: PATCH renames/recolors and DELETE removes the tag", async () => {
    const id = await createOk("Route Rename Me");
    const patched = await patchTagRoute(jsonRequest("PATCH", `/api/tags/${id}`, { name: "Route Renamed", color: "plum" }), routeParams({ id }));
    expect(patched.status).toBe(200);
    const [row] = await db.select({ name: schema.tags.name, color: schema.tags.color }).from(schema.tags).where(eq(schema.tags.id, id));
    expect(row).toEqual({ name: "Route Renamed", color: "plum" });

    expect((await deleteTagRoute(jsonRequest("DELETE", `/api/tags/${id}`), routeParams({ id }))).status).toBe(200);
    const gone = await deleteTagRoute(jsonRequest("DELETE", `/api/tags/${id}`), routeParams({ id }));
    expect(gone.status).toBe(404);
  });

  it("TAG-02: a PARTNER session gets 403 on EVERY tag route", async () => {
    const id = await createOk("Route Admin Only");
    const partner: ScopeContext = { tenantId, role: "partner", userId: partnerUserId, partnerId };
    setRouteScope(partner);
    try {
      const calls: [string, Promise<Response>][] = [
        ["GET /api/tags", listTagsRoute()],
        ["POST /api/tags", createTagRoute(jsonRequest("POST", "/api/tags", { name: "partner tag" }))],
        ["PATCH /api/tags/[id]", patchTagRoute(jsonRequest("PATCH", `/api/tags/${id}`, { name: "x" }), routeParams({ id }))],
        ["DELETE /api/tags/[id]", deleteTagRoute(jsonRequest("DELETE", `/api/tags/${id}`), routeParams({ id }))],
        ["GET /api/leads/[ref]/tags", leadTagsRoute(jsonRequest("GET", `/api/leads/${REF}/tags`), routeParams({ ref: REF }))],
        ["POST /api/leads/[ref]/tags", attachRoute(jsonRequest("POST", `/api/leads/${REF}/tags`, { tagId: id }), routeParams({ ref: REF }))],
        ["DELETE /api/leads/[ref]/tags/[tagId]", detachRoute(jsonRequest("DELETE", `/api/leads/${REF}/tags/${id}`), routeParams({ ref: REF, tagId: id }))],
      ];
      for (const [label, p] of calls) {
        const res = await p;
        expect(res.status, label).toBe(403);
        expect((await body(res)).code, label).toBe("forbidden");
      }
      // …and nothing the partner sent took effect.
      const [still] = await db.select({ name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.id, id));
      expect(still.name).toBe("Route Admin Only");
      const partnerTag = await db.select({ id: schema.tags.id }).from(schema.tags).where(eq(schema.tags.name, "partner tag"));
      expect(partnerTag).toHaveLength(0);
    } finally {
      setRouteScope(adminScope(tenantId, adminUserId));
    }
  });

  it("AUT-12: a mutating request without the CSRF pair is rejected with 403 csrf_rejected", async () => {
    const naked = new Request(`${APP_ORIGIN}/api/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "no csrf" }),
    });
    const res = await createTagRoute(naked);
    expect(res.status).toBe(403);
    expect((await body(res)).code).toBe("csrf_rejected");
  });

  it("returns 401 when there is no session", async () => {
    setRouteScope(null);
    try {
      const res = await listTagsRoute();
      expect(res.status).toBe(401);
      expect((await body(res)).code).toBe("unauthenticated");
    } finally {
      setRouteScope(adminScope(tenantId, adminUserId));
    }
  });
});
