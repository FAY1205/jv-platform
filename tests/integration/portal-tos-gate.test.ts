import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { recordTosAcceptance } from "@/lib/auth/tos-store";
import { CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";
import { releaseTenantLeads } from "../helpers/hold";

// F-04 / TR-4: a portal DATA route must refuse a partner who hasn't accepted the
// current ToS — not just the /portal landing page. getServerScope is injected at its
// seam (harness); getDb + requireTosResponse + the tos_acceptances table stay real.
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { GET } from "@/app/api/portal/leads/route";
import { GET as notesGet } from "@/app/api/leads/[ref]/notes/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-portal-tos-gate";

suite("F-04: portal data routes are ToS-gated", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  let partnerUserId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    if (partnerUserId) await db.delete(schema.tosAcceptances).where(inArray(schema.tosAcceptances.userId, [partnerUserId]));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "ToS Gate", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    const [p] = await db.insert(schema.partners).values({ tenantId, refId: "JV-001", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    partnerUserId = randomUUID();
    await db.insert(schema.users).values({ id: partnerUserId, tenantId, email: "px@tos.test", role: "partner", partnerId: p.id });
    const [u] = await db.insert(schema.uploads).values({ tenantId, refId: "IM-26-001", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({ tenantId, refId: "LD-26-00001", uploadId: u.id, dedupeKey: "x|1", rawJson: {}, partnerId: p.id, matchMethod: "zip", mlsStatus: "kept" });
    await releaseTenantLeads(db, tenantId); // released past the hold window so the partner can see it
    const partnerScope: ScopeContext = { tenantId, role: "partner", userId: partnerUserId, partnerId: p.id };
    setRouteScope(partnerScope);
  });

  afterAll(async () => {
    setRouteScope(null);
    await cleanup();
  });

  it("F-04: a partner who has NOT accepted the current ToS is refused (403 tos_required)", async () => {
    const res = await GET(jsonRequest("GET", "/api/portal/leads?page=1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("tos_required");
    expect(typeof body.traceId).toBe("string");
  });

  it("F-04: the shared lead-notes route is gated too (a partner reaches it via NotesPanel)", async () => {
    const res = await notesGet(jsonRequest("GET", "/api/leads/LD-26-00001/notes"), routeParams({ ref: "LD-26-00001" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("tos_required");
  });

  it("F-04: after accepting the current ToS, the same route serves data", async () => {
    await recordTosAcceptance(db, partnerUserId, CURRENT_TOS_VERSION);
    const res = await GET(jsonRequest("GET", "/api/portal/leads?page=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leads.map((l: { refId: string }) => l.refId)).toContain("LD-26-00001");
  });
});
