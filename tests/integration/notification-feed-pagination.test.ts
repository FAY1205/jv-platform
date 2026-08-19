import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { APP_ORIGIN, scopeContextMock, setRouteScope } from "./_route-harness";
import { encodeNotificationCursor } from "@/modules/notify/feed-cursor";

// WP-NF2 PR C (NTF-12 / FEP-03): keyset pagination on the notification feed, driven as the real
// route handler.
//
// The two failure modes a naive implementation has, and how each is forced here:
//
//  • GAPS/DUPES ACROSS A created_at TIE. Every fan-out inserts its recipients' rows inside ONE
//    statement, so `now()` — and therefore `created_at` — is byte-identical across the batch,
//    down to the microsecond. The seed below deliberately writes a block of rows that way, and
//    sets the page size so a page boundary lands INSIDE the tie. A cursor that carries only a
//    timestamp (or one truncated to a JS Date's milliseconds) either skips the rest of the tie
//    group or replays it; the walk assertion catches both because it compares the visited set,
//    in order, against the ground truth read straight from the table.
//
//  • A CURSOR THAT ESCAPES ownerWhere. The cursor narrows the predicate; it must never be able
//    to widen it. A colleague's and another tenant's cursors are replayed against this caller
//    and must return only this caller's rows — asserted in BOTH directions so a query that
//    simply returned nothing could not pass.
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

import { GET as getNotifications } from "@/app/api/notifications/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG_A = "test-notif-page-a";
const SLUG_B = "test-notif-page-b";

interface FeedBody {
  notifications: { id: string; title: string; createdAt: string }[];
  unread: number;
  nextCursor: string | null;
}

suite("NTF-12: notification feed keyset pagination (FEP-03)", () => {
  let db: ReturnType<typeof getDb>;
  const id: Record<string, string> = {};
  /** Ground truth for the caller's feed, in the exact order the endpoint must produce. */
  let expectedOrder: string[] = [];

  const meScope = (): ScopeContext => ({ tenantId: id.tenantA, role: "admin", userId: id.me });
  const colleagueScope = (): ScopeContext => ({ tenantId: id.tenantA, role: "admin", userId: id.colleague });
  const strangerScope = (): ScopeContext => ({ tenantId: id.tenantB, role: "admin", userId: id.stranger });

  async function cleanup() {
    const t = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.notifications).where(inArray(schema.notifications.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  /** Drive the real handler. `query` is the raw query string, e.g. "?limit=4". */
  async function feed(query = ""): Promise<FeedBody> {
    const res = await getNotifications(new Request(`${APP_ORIGIN}/api/notifications${query}`));
    expect(res.status).toBe(200);
    return (await res.json()) as FeedBody;
  }

  async function status(query: string): Promise<number> {
    return (await getNotifications(new Request(`${APP_ORIGIN}/api/notifications${query}`))).status;
  }

  /** Walk every page from the start at `limit`, returning the rows in visit order. */
  async function walk(limit: number): Promise<FeedBody["notifications"]> {
    const seen: FeedBody["notifications"] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const page: FeedBody = await feed(
        `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      seen.push(...page.notifications);
      if (!page.nextCursor) return seen;
      cursor = page.nextCursor;
    }
    throw new Error("pagination did not terminate");
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [ta] = await db.insert(schema.tenants).values({ name: "Feed page A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    const [tb] = await db.insert(schema.tenants).values({ name: "Feed page B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantA = ta.id;
    id.tenantB = tb.id;
    id.me = randomUUID();
    id.colleague = randomUUID();
    id.stranger = randomUUID();
    await db.insert(schema.users).values([
      { id: id.me, tenantId: ta.id, email: "me@fp.test", role: "admin" as const },
      { id: id.colleague, tenantId: ta.id, email: "colleague@fp.test", role: "admin" as const },
      { id: id.stranger, tenantId: tb.id, email: "stranger@fp.test", role: "admin" as const },
    ]);

    const row = (tenantId: string, userId: string, title: string, createdAt?: Date) => ({
      tenantId,
      userId,
      type: "status_change",
      title,
      body: null,
      deepLink: null,
      ...(createdAt ? { createdAt } : {}),
    });

    // Four rows on distinct, explicit instants (the ordered tail of the feed)…
    await db.insert(schema.notifications).values([
      row(ta.id, id.me, "distinct-1", new Date("2026-08-10T08:00:00.000Z")),
      row(ta.id, id.me, "distinct-2", new Date("2026-08-11T08:00:00.000Z")),
      row(ta.id, id.me, "distinct-3", new Date("2026-08-12T08:00:00.000Z")),
      row(ta.id, id.me, "distinct-4", new Date("2026-08-13T08:00:00.000Z")),
    ]);
    // …and FIVE rows written by ONE statement, which therefore share one `created_at` to the
    // microsecond — the fan-out shape. `now()` (the column default) is the transaction clock,
    // so all five collide exactly, and only the id tie-break can order them.
    await db.insert(schema.notifications).values([
      row(ta.id, id.me, "tie-a"),
      row(ta.id, id.me, "tie-b"),
      row(ta.id, id.me, "tie-c"),
      row(ta.id, id.me, "tie-d"),
      row(ta.id, id.me, "tie-e"),
    ]);
    // Neighbours the cursor must never reach.
    await db.insert(schema.notifications).values([
      row(ta.id, id.colleague, "colleague-1"),
      row(ta.id, id.colleague, "colleague-2"),
      row(tb.id, id.stranger, "stranger-1"),
      row(tb.id, id.stranger, "stranger-2"),
    ]);
    // The row that makes the TENANT leg of ownerWhere load-bearing: tenant B, but MY user id.
    // Every neighbour above differs from the caller in BOTH legs, so deleting
    // `eq(tenant_id, …)` from ownerWhere would ship green against them — the user pin alone
    // would still exclude every one. This row is excluded by the tenant pin and NOTHING else,
    // so it is the only fixture here that fails if that leg is dropped.
    //
    // It is deliberately INCONSISTENT data (a user of tenant A owning a tenant-B notification):
    // the two FKs are independent, so Postgres accepts it, and there is no RLS backstop to
    // catch it either — the table is deny-by-default and every reader is the service role
    // (ADR-0013: the app layer IS the boundary). This is exactly the shape a mis-scoped write
    // elsewhere would leave behind, and the read path must not surface it.
    await db.insert(schema.notifications).values([row(tb.id, id.me, "wrong-tenant")]);

    // The tie is real, not an accident of a fast machine: assert it before relying on it.
    const [tie] = await db.execute<{ n: number; distinct_at: number }>(sql`
      select count(*)::int as n, count(distinct created_at)::int as distinct_at
      from notifications where user_id = ${id.me} and title like 'tie-%'
    `);
    expect(Number(tie.n)).toBe(5);
    expect(Number(tie.distinct_at), "the five fan-out rows share one created_at").toBe(1);

    // Ground truth straight from the table, in the ordering the endpoint promises.
    const ordered = await db.execute<{ id: string }>(sql`
      select id from notifications
      where tenant_id = ${ta.id} and user_id = ${id.me}
      order by created_at desc, id desc
    `);
    expectedOrder = ordered.map((r) => r.id);
    expect(expectedOrder).toHaveLength(9);
  });

  afterAll(async () => {
    await cleanup();
    setRouteScope(null);
  });

  it("NTF-12: a cursor walk visits every row exactly once, in order, across a created_at tie", async () => {
    setRouteScope(meScope());
    // limit=2 puts a page boundary INSIDE the five-row tie group (rows 5 and 6 of 9 are both
    // ties), which is precisely where a timestamp-only cursor loses or repeats rows.
    for (const limit of [1, 2, 3, 4]) {
      const seen = (await walk(limit)).map((n) => n.id);
      expect(seen, `limit=${limit}: no gaps, no dupes, correct order`).toEqual(expectedOrder);
      expect(new Set(seen).size, `limit=${limit}: every id unique`).toBe(expectedOrder.length);
    }
  });

  it("PRN-08: the TENANT leg is load-bearing — a foreign-tenant row owned by MY user id is invisible", async () => {
    // The only fixture in this suite excluded by the tenant pin ALONE. If `eq(tenant_id, …)`
    // were dropped from ownerWhere, every other negative here would still pass on the user pin
    // and this one — and only this one — would start appearing.
    setRouteScope(meScope());

    // Not on any page of a full cursor walk (at a page size that puts boundaries inside the tie).
    const walked = await walk(2);
    expect(walked.map((n) => n.title)).not.toContain("wrong-tenant");
    expect(walked.map((n) => n.id)).toEqual(expectedOrder);

    // Not on the bare call either, and it does not inflate the count the header renders.
    const bare = await feed();
    expect(bare.notifications).toHaveLength(9);
    expect(bare.notifications.map((n) => n.title)).not.toContain("wrong-tenant");
    expect(bare.unread).toBe(9);

    // …and the row genuinely exists — otherwise this test proves nothing at all.
    const [present] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from notifications
      where tenant_id = ${id.tenantB} and user_id = ${id.me} and title = 'wrong-tenant'
    `);
    expect(Number(present.n), "the inconsistent fixture row was actually inserted").toBe(1);
  });

  it("NTF-12: nextCursor is null exactly when the page was not full", async () => {
    setRouteScope(meScope());
    // 9 rows: a limit of 4 fills pages 1 and 2, page 3 returns 1 row and ends the feed.
    const p1 = await feed("?limit=4");
    expect(p1.notifications).toHaveLength(4);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await feed(`?limit=4&cursor=${encodeURIComponent(p1.nextCursor!)}`);
    expect(p2.notifications).toHaveLength(4);
    expect(p2.nextCursor).not.toBeNull();
    const p3 = await feed(`?limit=4&cursor=${encodeURIComponent(p2.nextCursor!)}`);
    expect(p3.notifications).toHaveLength(1);
    expect(p3.nextCursor).toBeNull();

    // An exactly-full LAST page still hands back a cursor (the server cannot know it is the
    // end without looking ahead); following it must yield an empty, terminating page rather
    // than wrapping around to the start.
    const exact = await feed("?limit=9");
    expect(exact.notifications).toHaveLength(9);
    expect(exact.nextCursor).not.toBeNull();
    const after = await feed(`?limit=9&cursor=${encodeURIComponent(exact.nextCursor!)}`);
    expect(after.notifications).toEqual([]);
    expect(after.nextCursor).toBeNull();
  });

  it("NTF-12: the BARE call keeps today's shape — 30 newest rows plus the additive nextCursor", async () => {
    setRouteScope(meScope());
    const body = await feed();
    expect(body.notifications.map((n) => n.id)).toEqual(expectedOrder); // all 9, newest first
    expect(body.unread).toBe(9);
    expect(body.nextCursor).toBeNull(); // fewer than the default 30 → the feed ended
  });

  it("PRN-08/TST-01: a cursor cannot escape ownerWhere — cross-user and cross-tenant, both ways", async () => {
    // Mint cursors as the OTHER subjects, then replay them as me.
    setRouteScope(colleagueScope());
    const colleaguePage = await feed("?limit=1");
    expect(colleaguePage.notifications).toHaveLength(1);
    const colleagueCursor = colleaguePage.nextCursor!;

    setRouteScope(strangerScope());
    const strangerPage = await feed("?limit=1");
    const strangerCursor = strangerPage.nextCursor!;

    setRouteScope(meScope());
    for (const [who, cursor] of [
      ["colleague", colleagueCursor],
      ["stranger", strangerCursor],
    ] as const) {
      const body = await feed(`?limit=30&cursor=${encodeURIComponent(cursor)}`);
      const titles = body.notifications.map((n) => n.title);
      expect(titles.every((t) => t.startsWith("distinct-") || t.startsWith("tie-")), `${who}'s cursor`).toBe(true);
      expect(titles.some((t) => t.startsWith("colleague-") || t.startsWith("stranger-"))).toBe(false);
      expect(body.unread, `${who}'s cursor never changes MY count`).toBe(9);
    }

    // A hand-built cursor pointing at the far future cannot pull in anyone else's rows either —
    // it can only ever narrow, so it returns a PREFIX of my own feed.
    const future = encodeNotificationCursor({
      createdAt: "2999-01-01T00:00:00.000000Z",
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });
    setRouteScope(meScope());
    const wide = await feed(`?limit=30&cursor=${encodeURIComponent(future)}`);
    expect(wide.notifications.map((n) => n.id)).toEqual(expectedOrder);

    // The complement — each neighbour still sees their OWN rows, so the assertions above are
    // not passing merely because the query returns nothing.
    setRouteScope(colleagueScope());
    expect((await feed()).notifications.map((n) => n.title).sort()).toEqual(["colleague-1", "colleague-2"]);
    setRouteScope(strangerScope());
    expect((await feed()).notifications.map((n) => n.title).sort()).toEqual(["stranger-1", "stranger-2"]);
  });

  it("NTF-12: a malformed cursor is 400 invalid_input, never a silent page one", async () => {
    setRouteScope(meScope());
    for (const bad of ["not-base64!!", "Zm9v", "a".repeat(300), encodeURIComponent("has space")]) {
      expect(await status(`?cursor=${bad}`), `cursor=${bad}`).toBe(400);
    }
    const res = await getNotifications(new Request(`${APP_ORIGIN}/api/notifications?cursor=Zm9v`));
    const body = (await res.json()) as { code: string; message: string; traceId: string };
    expect(body.code).toBe("invalid_input");
    expect(typeof body.traceId).toBe("string");
    expect(body.traceId.length).toBeGreaterThan(0);
  });

  it("NTF-12: limit is bounded — 1..50, integers only; out-of-range is 400 not a clamp", async () => {
    setRouteScope(meScope());
    expect((await feed("?limit=1")).notifications).toHaveLength(1);
    expect((await feed("?limit=50")).notifications).toHaveLength(9); // the ceiling is accepted
    for (const bad of ["0", "-1", "51", "1000", "2.5", "abc", ""]) {
      expect(await status(`?limit=${bad}`), `limit=${bad}`).toBe(400);
    }
  });

  it("NTF-12: an unauthenticated call is 401 — the query string never gets a word in first", async () => {
    setRouteScope(null);
    expect(await status("?limit=999&cursor=garbage")).toBe(401);
  });
});
