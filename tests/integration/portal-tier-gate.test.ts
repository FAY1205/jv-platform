import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";

// ─────────────────────────────────────────────────────────────────────────────
// AUTHZ-08 (ADR-0047 Phase C amendment, audit-tenancy WP-ROLE-1a F-1/F-2): the portal
// pass-through is capability-checked for ADMIN-STREAM callers. Without this, a viewer
// scope reaching /api/portal/leads/export pulls a FULL-TENANT seller-PII workbook
// through partner-shaped code, and a viewer could write lead statuses. The scope is
// injected at the getServerScope seam (member/viewer are TYPE-only until the enum
// migration — exactly why the live proof must come from the seam, not a real session).
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

import { GET as exportGet } from "@/app/api/portal/leads/export/route";
import { GET as portalLeadsGet } from "@/app/api/portal/leads/route";
import { POST as statusPost } from "@/app/api/portal/leads/[ref]/status/route";
import { POST as notesPost } from "@/app/api/leads/[ref]/notes/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-portal-tier-gate";

suite("AUTHZ-08: portal pass-through is capability-checked for staff tiers", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;

  const staff = (role: "admin" | "member" | "viewer"): ScopeContext => ({
    tenantId,
    role,
    userId: randomUUID(),
  });

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    // A bare tenant is enough: the gate fires BEFORE any query, and the admin pass-through
    // legs are satisfied by empty result sets.
    const [t] = await db.insert(schema.tenants).values({ name: "Tier Gate", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
  });

  afterAll(async () => {
    await cleanup();
    setRouteScope(null);
  });

  it("AUTHZ-08: viewer is 403'd on the portal export (data.export)", async () => {
    setRouteScope(staff("viewer"));
    const res = await exportGet();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("AUTHZ-08: member is 403'd on the portal export (data.export not held by default)", async () => {
    setRouteScope(staff("member"));
    const res = await exportGet();
    expect(res.status).toBe(403);
  });

  it("AUTHZ-08: viewer is 403'd on the portal status write (leads.write)", async () => {
    setRouteScope(staff("viewer"));
    const res = await statusPost(
      jsonRequest("POST", "/api/portal/leads/LD-26-00001/status", { status: "contacted" }),
      routeParams({ ref: "LD-26-00001" }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("AUTHZ-08: viewer is 403'd on a note WRITE but passes the portal leads READ (leads.read)", async () => {
    setRouteScope(staff("viewer"));
    const denied = await notesPost(
      jsonRequest("POST", "/api/leads/LD-26-00001/notes", { body: "hi" }),
      routeParams({ ref: "LD-26-00001" }),
    );
    expect(denied.status).toBe(403);
    const read = await portalLeadsGet(new Request("http://localhost:3000/api/portal/leads"));
    expect(read.status).toBe(200);
  });

  it("AUTHZ-08: admin pass-through is unchanged (ADR-0047 — export + read both pass the gate)", async () => {
    setRouteScope(staff("admin"));
    const read = await portalLeadsGet(new Request("http://localhost:3000/api/portal/leads"));
    expect(read.status).toBe(200);
    const exp = await exportGet();
    // The gate passes; an empty tenant yields a normal (empty) export, never a 403.
    expect(exp.status).not.toBe(403);
  });

  it("AUTHZ-08: a member with a tenant-configured grant of data.export passes the gate", async () => {
    setRouteScope({ ...staff("member"), capabilities: new Set(["leads.read", "views.own", "data.export"]) });
    const res = await exportGet();
    expect(res.status).not.toBe(403);
  });
});
