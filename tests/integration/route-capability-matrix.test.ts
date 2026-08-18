import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";
import { purgeAuditLog } from "../helpers/audit";

// ─────────────────────────────────────────────────────────────────────────────
// AUTHZ-09 (WP-ROLE-2): the cluster-A capability matrix, proven at the HTTP layer for
// every migrated route. Table-driven: a VIEWER passes every read (leads.read/views.own)
// and 403s on every write; a MEMBER passes leads.write writes but 403s on rules.manage
// (tag management); ADMIN behavior is byte-identical to pre-migration (all pass).
// Member/viewer scopes are seam-injected (type-only until the enum migration).
// A member-allowed write may 404/400 on missing data — the assertion is "not 403"
// (the gate passed); reads assert 200 against the seeded empty tenant.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

import { GET as dashboardGet } from "@/app/api/dashboard/route";
import { GET as leadsGet } from "@/app/api/leads/route";
import { GET as leadsCountGet } from "@/app/api/leads/count/route";
import { GET as boardGet } from "@/app/api/leads/board/route";
import { GET as sourcesGet } from "@/app/api/leads/sources/route";
import { GET as unmatchedGet } from "@/app/api/leads/unmatched/route";
import { GET as unmatchedCountGet } from "@/app/api/leads/unmatched/count/route";
import { GET as searchGet } from "@/app/api/search/route";
import { GET as coverageGet } from "@/app/api/coverage/route";
import { GET as tagsGet, POST as tagsPost } from "@/app/api/tags/route";
import { PATCH as tagPatch, DELETE as tagDelete } from "@/app/api/tags/[id]/route";
import { GET as savedViewsGet, POST as savedViewsPost } from "@/app/api/saved-views/route";
import { PATCH as leadPatch } from "@/app/api/leads/[ref]/route";
import { POST as statusPost } from "@/app/api/leads/[ref]/status/route";
import { POST as assignPost } from "@/app/api/leads/[ref]/assign/route";
import { POST as assignBulkPost } from "@/app/api/leads/assign-bulk/route";
import { POST as leadTagPost } from "@/app/api/leads/[ref]/tags/route";
import { DELETE as leadTagDelete } from "@/app/api/leads/[ref]/tags/[tagId]/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-route-cap-matrix";
const REF = "LD-26-90001";

suite("AUTHZ-09: cluster-A route capability matrix", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;

  const staff = (role: "admin" | "member" | "viewer"): ScopeContext => ({ tenantId, role, userId: randomUUID() });

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.savedViews).where(inArray(schema.savedViews.tenantId, tids));
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.tags).where(inArray(schema.tags.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Cap Matrix", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
  });

  afterAll(async () => {
    await cleanup();
    setRouteScope(null);
  });

  const READS: [string, () => Promise<Response>][] = [
    ["dashboard", () => dashboardGet(new Request("http://localhost:3000/api/dashboard"))],
    ["leads list", () => leadsGet(new Request("http://localhost:3000/api/leads"))],
    ["leads count", () => leadsCountGet()],
    ["board", () => boardGet(new Request("http://localhost:3000/api/leads/board"))],
    ["sources", () => sourcesGet()],
    ["unmatched", () => unmatchedGet()],
    ["unmatched count", () => unmatchedCountGet()],
    ["search", () => searchGet(new Request("http://localhost:3000/api/search?q=smith"))],
    ["coverage", () => coverageGet()],
    ["tags roster", () => tagsGet()],
    ["saved views", () => savedViewsGet()],
  ];

  const LEAD_WRITES: [string, () => Promise<Response>][] = [
    ["lead PATCH", () => leadPatch(jsonRequest("PATCH", `/api/leads/${REF}`, { address: "1 Main St" }), routeParams({ ref: REF }))],
    ["status POST", () => statusPost(jsonRequest("POST", `/api/leads/${REF}/status`, { status: "Contacted" }), routeParams({ ref: REF }))],
    ["assign POST", () => assignPost(jsonRequest("POST", `/api/leads/${REF}/assign`, { partnerId: randomUUID() }), routeParams({ ref: REF }))],
    ["assign-bulk POST", () => assignBulkPost(jsonRequest("POST", "/api/leads/assign-bulk", { refIds: [REF], partnerId: randomUUID() }))],
    ["lead tag POST", () => leadTagPost(jsonRequest("POST", `/api/leads/${REF}/tags`, { tagId: randomUUID() }), routeParams({ ref: REF }))],
    ["lead tag DELETE", () => leadTagDelete(jsonRequest("DELETE", `/api/leads/${REF}/tags/${randomUUID()}`), routeParams({ ref: REF, tagId: randomUUID() }))],
  ];

  const RULES_WRITES: [string, () => Promise<Response>][] = [
    ["tag create", () => tagsPost(jsonRequest("POST", "/api/tags", { name: "x" }))],
    ["tag rename", () => tagPatch(jsonRequest("PATCH", `/api/tags/${randomUUID()}`, { name: "y" }), routeParams({ id: randomUUID() }))],
    ["tag delete", () => tagDelete(jsonRequest("DELETE", `/api/tags/${randomUUID()}`), routeParams({ id: randomUUID() }))],
  ];

  it("AUTHZ-09: viewer passes every cluster-A read (leads.read/views.own)", async () => {
    setRouteScope(staff("viewer"));
    for (const [name, call] of READS) {
      const res = await call();
      expect(res.status, `viewer read: ${name}`).toBe(200);
    }
  });

  it("AUTHZ-09: viewer 403s on every write (leads.write + rules.manage)", async () => {
    setRouteScope(staff("viewer"));
    for (const [name, call] of [...LEAD_WRITES, ...RULES_WRITES]) {
      const res = await call();
      expect(res.status, `viewer write: ${name}`).toBe(403);
      expect(await res.json()).toMatchObject({ code: "forbidden" });
    }
  });

  it("AUTHZ-09: member passes leads.write gates but 403s on rules.manage (tag management)", async () => {
    setRouteScope(staff("member"));
    for (const [name, call] of LEAD_WRITES) {
      const res = await call();
      expect(res.status, `member lead-write gate: ${name}`).not.toBe(403);
    }
    for (const [name, call] of RULES_WRITES) {
      const res = await call();
      expect(res.status, `member rules-write: ${name}`).toBe(403);
    }
  });

  it("AUTHZ-09: viewer may create a saved view (views.own is personal chrome, deliberately)", async () => {
    setRouteScope(staff("viewer"));
    const res = await savedViewsPost(jsonRequest("POST", "/api/saved-views", { name: "mine", filters: {} }));
    expect(res.status).not.toBe(403);
  });

  it("AUTHZ-09: admin passes everything (byte-identical to pre-migration)", async () => {
    setRouteScope(staff("admin"));
    for (const [name, call] of READS) {
      const res = await call();
      expect(res.status, `admin read: ${name}`).toBe(200);
    }
    for (const [name, call] of [...LEAD_WRITES, ...RULES_WRITES]) {
      const res = await call();
      expect(res.status, `admin write gate: ${name}`).not.toBe(403);
    }
  });
});
