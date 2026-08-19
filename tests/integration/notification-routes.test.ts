import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { APP_ORIGIN, jsonRequest, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";

// WP-NF1 (NTF-04): the three notification-centre endpoints, driven as real handlers. The bell
// is the one surface where a scope slip is invisible to the victim — you cannot tell you are
// being shown a colleague's (or another tenant's) notifications — so the isolation is pinned at
// the HTTP boundary, not just in the module. getServerScope is injected at its seam; CSRF runs
// UNMOCKED against a real double-submit pair (see _route-harness).
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { GET as getNotifications } from "@/app/api/notifications/route";
import { POST as postRead } from "@/app/api/notifications/[id]/read/route";
import { POST as postReadAll } from "@/app/api/notifications/read-all/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG_A = "test-notif-routes-a";
const SLUG_B = "test-notif-routes-b";

interface FeedBody {
  notifications: { id: string; title: string; readAt: string | null; deepLink: string | null }[];
  unread: number;
  /** FEP-03 (WP-NF2 PR C): additive — null on a page that was not full. */
  nextCursor: string | null;
}

/** The BARE feed request (no query) — the exact call the bell makes. */
const feedRequest = (query = "") => new Request(`${APP_ORIGIN}/api/notifications${query}`);

suite("NTF-04: notification routes (list · mark read · mark all read)", () => {
  let db: ReturnType<typeof getDb>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  const meScope = (): ScopeContext => ({ tenantId: id.tenantA, role: "admin", userId: id.me });
  const colleagueScope = (): ScopeContext => ({ tenantId: id.tenantA, role: "admin", userId: id.colleague });
  const otherTenantScope = (): ScopeContext => ({ tenantId: id.tenantB, role: "admin", userId: id.stranger });

  const feed = async (): Promise<FeedBody> => {
    const res = await getNotifications(feedRequest());
    expect(res.status).toBe(200);
    return (await res.json()) as FeedBody;
  };
  const rowsFor = (userId: string) =>
    db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [ta] = await db.insert(schema.tenants).values({ name: "Notif routes A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    const [tb] = await db.insert(schema.tenants).values({ name: "Notif routes B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantA = ta.id;
    id.tenantB = tb.id;
    id.me = randomUUID();
    id.colleague = randomUUID();
    id.stranger = randomUUID();
    await db.insert(schema.users).values([
      { id: id.me, tenantId: ta.id, email: "me@nr.test", role: "admin" as const },
      { id: id.colleague, tenantId: ta.id, email: "colleague@nr.test", role: "admin" as const },
      { id: id.stranger, tenantId: tb.id, email: "stranger@nr.test", role: "admin" as const },
    ]);

    const rows = await db
      .insert(schema.notifications)
      .values([
        { tenantId: ta.id, userId: id.me, type: "run_summary", title: "Mine: older", body: null, deepLink: "/imports/IM-26-001", createdAt: new Date("2026-08-18T08:00:00.000Z") },
        { tenantId: ta.id, userId: id.me, type: "status_change", title: "Mine: newer", body: "b", deepLink: "/leads?open=LD-26-00001", createdAt: new Date("2026-08-18T09:00:00.000Z") },
        // Same tenant, DIFFERENT user — the sideways leak a cross-tenant probe would never catch.
        { tenantId: ta.id, userId: id.colleague, type: "status_change", title: "Colleague's", body: null, createdAt: new Date("2026-08-18T10:00:00.000Z") },
        // Different tenant entirely.
        { tenantId: tb.id, userId: id.stranger, type: "run_summary", title: "Other tenant's", body: null, createdAt: new Date("2026-08-18T11:00:00.000Z") },
      ])
      .returning({ id: schema.notifications.id, title: schema.notifications.title });
    for (const r of rows) id[`n:${r.title}`] = r.id;
  });

  afterAll(async () => {
    await cleanup();
    setRouteScope(null);
  });

  it("NTF-04: GET returns ONLY the caller's own rows, newest first, with the unread count", async () => {
    setRouteScope(meScope());
    const body = await feed();
    expect(body.notifications.map((n) => n.title)).toEqual(["Mine: newer", "Mine: older"]); // created_at desc
    expect(body.unread).toBe(2);
  });

  it("PRN-08/TST-01: GET never returns a colleague's or another tenant's notifications", async () => {
    setRouteScope(meScope());
    const mine = await feed();
    expect(mine.notifications.some((n) => n.title === "Colleague's")).toBe(false);
    expect(mine.notifications.some((n) => n.title === "Other tenant's")).toBe(false);

    // The complement: the colleague sees theirs and not mine. A one-sided assertion would pass
    // against a query that simply returned nothing.
    setRouteScope(colleagueScope());
    const theirs = await feed();
    expect(theirs.notifications.map((n) => n.title)).toEqual(["Colleague's"]);
    expect(theirs.unread).toBe(1);

    setRouteScope(otherTenantScope());
    expect((await feed()).notifications.map((n) => n.title)).toEqual(["Other tenant's"]);
  });

  it("NTF-04: GET without a session is 401, not an empty feed", async () => {
    setRouteScope(null);
    const res = await getNotifications(feedRequest());
    expect(res.status).toBe(401);
  });

  it("NTF-04: POST /read marks the caller's own row and is IDEMPOTENT (read_at never moves)", async () => {
    setRouteScope(meScope());
    const target = id["n:Mine: older"];
    const res = await postRead(jsonRequest("POST", `/api/notifications/${target}/read`, {}), routeParams({ id: target }));
    expect(res.status).toBe(200);
    expect((await feed()).unread).toBe(1);

    const firstReadAt = (await rowsFor(id.me)).find((n) => n.id === target)!.readAt!;
    // A second POST must not re-stamp: the mark is `WHERE read_at IS NULL`, so a double click
    // (or the optimistic UI settling twice) can't drift the timestamp forward.
    expect((await postRead(jsonRequest("POST", `/api/notifications/${target}/read`, {}), routeParams({ id: target }))).status).toBe(200);
    expect((await rowsFor(id.me)).find((n) => n.id === target)!.readAt!.getTime()).toBe(firstReadAt.getTime());
    expect((await feed()).unread).toBe(1);
  });

  it("PRN-08: POST /read on someone else's notification is a silent no-op, never a cross-user write", async () => {
    setRouteScope(meScope());
    const theirs = id["n:Colleague's"];
    // 200 by design — the route must not leak "this id exists but isn't yours" via the status.
    const res = await postRead(jsonRequest("POST", `/api/notifications/${theirs}/read`, {}), routeParams({ id: theirs }));
    expect(res.status).toBe(200);
    expect((await rowsFor(id.colleague)).find((n) => n.id === theirs)!.readAt).toBeNull(); // untouched

    // Same for another tenant's row.
    const foreign = id["n:Other tenant's"];
    expect((await postRead(jsonRequest("POST", `/api/notifications/${foreign}/read`, {}), routeParams({ id: foreign }))).status).toBe(200);
    expect((await rowsFor(id.stranger)).find((n) => n.id === foreign)!.readAt).toBeNull();
  });

  it("NTF-04: POST /read rejects a non-uuid id (400) and a missing CSRF token (403)", async () => {
    setRouteScope(meScope());
    expect((await postRead(jsonRequest("POST", "/api/notifications/not-a-uuid/read", {}), routeParams({ id: "not-a-uuid" }))).status).toBe(400);
    const noCsrf = new Request("http://localhost:3000/api/notifications/x/read", { method: "POST", body: "{}" });
    expect((await postRead(noCsrf, routeParams({ id: id["n:Mine: newer"] }))).status).toBe(403);
  });

  it("NTF-04: POST /read-all clears only the caller's unread rows", async () => {
    setRouteScope(meScope());
    expect((await postReadAll(jsonRequest("POST", "/api/notifications/read-all", {}))).status).toBe(200);
    const body = await feed();
    expect(body.unread).toBe(0);
    expect(body.notifications.every((n) => n.readAt !== null)).toBe(true);

    // The colleague's row is still unread — read-all is per USER, not per tenant.
    expect((await rowsFor(id.colleague)).every((n) => n.readAt === null)).toBe(true);
    setRouteScope(colleagueScope());
    expect((await feed()).unread).toBe(1);

    // Idempotent: a second read-all on an already-clear feed is a harmless no-op.
    setRouteScope(meScope());
    expect((await postReadAll(jsonRequest("POST", "/api/notifications/read-all", {}))).status).toBe(200);
    expect((await feed()).unread).toBe(0);
  });
});
