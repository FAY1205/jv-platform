import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { listLeadsBoard } from "@/modules/leads/queries";
import { BoardQuerySchema } from "@/modules/leads/schema";
import { updateLeadStatus } from "@/modules/portal/status-update";
import { BOARD_COLUMNS, BOARD_PAGE_SIZE } from "@/modules/leads/board";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { adminScope, jsonRequest, scopeContextMock, setRouteScope } from "./_route-harness";

// WP-KAN-1 · KAN-02: the Leads board read. getServerScope is injected at its module
// seam so the route runs as a real caller without a live Supabase session; the Zod
// contract, the query, and the DB all stay real (see _route-harness).
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { GET as getBoard } from "@/app/api/leads/board/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG_A = "test-leads-board-a";
const SLUG_B = "test-leads-board-b";

// A fixed clock for the seed data so "days in status" assertions never straddle a day
// boundary. The board itself stores only `statusSince`; the age is derived client-side
// by the pure boardAge (KAN-03), covered in tests/unit/board-age.test.ts.
const T0 = Date.now();
const ago = (ms: number) => new Date(T0 - ms);
const MIN = 60_000;

suite("WP-KAN-1: leads board endpoint (KAN-02/03/08/09)", () => {
  let db: ReturnType<typeof getDb>;
  const id: Record<string, string> = {};
  const adminUserId = randomUUID();
  const partnerUserId = randomUUID();

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();

    // ── Tenant A: the board under test ──────────────────────────────────────
    const [tA] = await db.insert(schema.tenants).values({ name: "Board A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    id.tenantA = tA.id;
    const [pA] = await db
      .insert(schema.partners)
      .values({ tenantId: tA.id, refId: "JV-801", name: "Board Partner", color: "#2F6DB0", status: "active" })
      .returning({ id: schema.partners.id });
    id.partnerA = pA.id;
    const [pA2] = await db
      .insert(schema.partners)
      .values({ tenantId: tA.id, refId: "JV-802", name: "Other Partner", color: "#2E7D5B", status: "active" })
      .returning({ id: schema.partners.id });
    id.partnerA2 = pA2.id;
    await db.insert(schema.users).values([
      { id: adminUserId, tenantId: tA.id, email: "admin@board-a.test", role: "admin" as const },
      { id: partnerUserId, tenantId: tA.id, email: "px@board-a.test", role: "partner" as const, partnerId: pA.id },
    ]);
    const [upA] = await db.insert(schema.uploads).values({ tenantId: tA.id, refId: "IM-26-801", filename: "a.csv", status: "processed" }).returning({ id: schema.uploads.id });

    const lead = (refId: string, v: Partial<typeof schema.leads.$inferInsert> = {}) => ({
      tenantId: tA.id, refId, uploadId: upA.id, dedupeKey: randomUUID(), rawJson: {},
      mlsStatus: "kept" as const, matchMethod: "none" as const, ...v,
    });

    // 26 never-moved leads → the "New" column, one page (25) + one over (KAN-02).
    // Descending createdAt so the page order is deterministic.
    await db.insert(schema.leads).values(
      Array.from({ length: 26 }, (_, i) =>
        lead(`LD-26-80${String(100 + i)}`, {
          sellerFirst: "New", sellerLast: `Seller${i}`, city: "Mesa", state: "AZ",
          partnerId: pA.id, matchMethod: "zip", createdAt: ago((i + 1) * MIN),
        }),
      ),
    );

    // A lead with MULTIPLE history rows — it must land in its LATEST column.
    await db.insert(schema.leads).values(
      lead("LD-26-80900", { sellerFirst: "Marcus", sellerLast: "Whitfield", city: "Phoenix", state: "AZ", partnerId: pA.id, matchMethod: "zip", createdAt: ago(90 * MIN) }),
    );
    // An unmatched (no partner, no manual overlay) lead — KAN-08 warn shape.
    await db.insert(schema.leads).values(
      lead("LD-26-80901", { sellerFirst: "June", sellerLast: "Park", city: "Norfolk", state: "VA", createdAt: ago(80 * MIN) }),
    );
    // A HOT lead owned by the second partner — KAN-09 hot + partner filters.
    await db.insert(schema.leads).values(
      lead("LD-26-80902", { sellerFirst: "Alma", sellerLast: "Reyes", city: "Gilbert", state: "AZ", partnerId: pA2.id, matchMethod: "state_fallback", scoreGroup: "hot", scoreTotal: 41, scoreStatus: "complete", createdAt: ago(70 * MIN) }),
    );
    // KAN-08 exclusions: removed-from-MLS and recalled (soft-deleted) never appear.
    await db.insert(schema.leads).values(lead("LD-26-80903", { mlsStatus: "removed", mlsReason: "listed", sellerFirst: "Rem", sellerLast: "Oved", createdAt: ago(60 * MIN) }));
    await db.insert(schema.leads).values(lead("LD-26-80904", { deletedAt: new Date(), sellerFirst: "Re", sellerLast: "Called", createdAt: ago(50 * MIN) }));

    const seedScope: ScopeContext = { tenantId: tA.id, role: "admin", userId: adminUserId };
    // Real writes through the SAME command the status endpoint uses (KAN-04) — the
    // board reads whatever that appends, never its own notion of "current".
    await updateLeadStatus(seedScope, "LD-26-80900", "Contacted");
    await updateLeadStatus(seedScope, "LD-26-80900", "Appointment"); // latest wins
    await updateLeadStatus(seedScope, "LD-26-80901", "Contacted");
    await updateLeadStatus(seedScope, "LD-26-80902", "Contacted");

    // ── Tenant B: must never appear in A's board (TST-01 probe) ─────────────
    const [tB] = await db.insert(schema.tenants).values({ name: "Board B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantB = tB.id;
    id.adminB = randomUUID();
    const bAdmin = id.adminB;
    await db.insert(schema.users).values({ id: bAdmin, tenantId: tB.id, email: "admin@board-b.test", role: "admin" as const });
    const [pB] = await db
      .insert(schema.partners)
      .values({ tenantId: tB.id, refId: "JV-899", name: "Foreign Partner", color: "#B23A48", status: "active" })
      .returning({ id: schema.partners.id });
    id.partnerB = pB.id;
    // A SECOND tenant-B partner that no tenant-A row references — the clean probe for the
    // BOLA leg below (pB itself is deliberately mis-referenced by the R-65 fixture).
    const [pB2] = await db
      .insert(schema.partners)
      .values({ tenantId: tB.id, refId: "JV-898", name: "Foreign Partner 2", color: "#4C1553", status: "active" })
      .returning({ id: schema.partners.id });
    id.partnerB2 = pB2.id;

    // R-65 leg (audit-tenancy F-2): a tenant-A lead whose partner_id points at tenant B's
    // partner. The FK is global, so this is insertable — the JOIN's tenant predicate is the
    // only thing that stops B's name/colour appearing on A's board.
    await db.insert(schema.leads).values(
      lead("LD-26-80905", { sellerFirst: "Cross", sellerLast: "Tenant", city: "Reno", state: "NV", partnerId: pB.id, matchMethod: "zip", createdAt: ago(40 * MIN) }),
    );
    await updateLeadStatus(seedScope, "LD-26-80905", "Closed");

    const [upB] = await db.insert(schema.uploads).values({ tenantId: tB.id, refId: "IM-26-802", filename: "b.csv", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({
      tenantId: tB.id, refId: "LD-26-80999", uploadId: upB.id, dedupeKey: randomUUID(), rawJson: {},
      mlsStatus: "kept", matchMethod: "none", sellerFirst: "Foreign", sellerLast: "Lead", city: "Boston", state: "MA",
    });
    await updateLeadStatus({ tenantId: tB.id, role: "admin", userId: bAdmin }, "LD-26-80999", "Appointment");

    setRouteScope(adminScope(id.tenantA, adminUserId));
  });

  afterAll(async () => {
    setRouteScope(null);
    await cleanup();
  });

  const scopeA = (): ScopeContext => ({ tenantId: id.tenantA, role: "admin", userId: adminUserId });
  const board = (params: Record<string, unknown> = {}) => listLeadsBoard(scopeA(), BoardQuerySchema.parse(params));
  const col = (b: Awaited<ReturnType<typeof board>>, status: string) => b.columns.find((c) => c.status === status)!;
  const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

  it("KAN-02: returns all six workflow columns in order, with true totals", async () => {
    const b = await board();
    expect(b.columns.map((c) => c.status)).toEqual(["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead"]);
    expect(col(b, "New").total).toBe(26);
    expect(col(b, "Contacted").total).toBe(2);
    expect(col(b, "Appointment").total).toBe(1);
    expect(col(b, "Under contract").total).toBe(0);
    expect(col(b, "Under contract").cards).toEqual([]);
    expect(col(b, "Closed").total).toBe(1);
    expect(col(b, "Dead").total).toBe(0);
    expect(b.pageSize).toBe(BOARD_PAGE_SIZE);
  });

  it("KAN-02: a lead with multiple history rows lands in its LATEST column only", async () => {
    const b = await board();
    expect(col(b, "Appointment").cards.map((c) => c.refId)).toEqual(["LD-26-80900"]);
    expect(col(b, "Contacted").cards.map((c) => c.refId)).not.toContain("LD-26-80900");
    expect(col(b, "New").cards.map((c) => c.refId)).not.toContain("LD-26-80900");
  });

  it("KAN-02: page 1 caps a column at 25 cards while reporting the true count; ?status&page loads the rest", async () => {
    const p1 = await board();
    expect(col(p1, "New").cards).toHaveLength(25);
    expect(col(p1, "New").total).toBe(26);

    const p2 = await board({ status: "New", page: "2" });
    // A single-column load-more returns just that column.
    expect(p2.columns.map((c) => c.status)).toEqual(["New"]);
    expect(p2.columns[0].cards).toHaveLength(1);
    expect(p2.columns[0].total).toBe(26); // still the TRUE count
    expect(p2.columns[0].page).toBe(2);

    // No overlap between the two pages, and together they are the whole column.
    const refs1 = col(p1, "New").cards.map((c) => c.refId);
    const refs2 = p2.columns[0].cards.map((c) => c.refId);
    expect(new Set([...refs1, ...refs2]).size).toBe(26);

    // A page past the end is empty but still reports the true total.
    const p9 = await board({ status: "New", page: "9" });
    expect(p9.columns[0].cards).toEqual([]);
    expect(p9.columns[0].total).toBe(26);
  });

  it("KAN-08: removed-from-MLS and recalled leads never appear in any column", async () => {
    const b = await board();
    const all = b.columns.flatMap((c) => c.cards.map((x) => x.refId));
    expect(all).not.toContain("LD-26-80903"); // removed
    expect(all).not.toContain("LD-26-80904"); // soft-deleted
    expect(b.columns.reduce((n, c) => n + c.total, 0)).toBe(30); // 26 New + 2 Contacted + 1 Appointment + 1 Closed
  });

  it("KAN-03/KAN-08: the card payload carries seller, city/state, partner or null, hot + score, and statusSince", async () => {
    const b = await board();
    const contacted = col(b, "Contacted").cards;

    const unmatched = contacted.find((c) => c.refId === "LD-26-80901")!;
    expect(unmatched.partner).toBeNull(); // → the "Unmatched" warn label (KAN-08)
    expect(unmatched.seller).toBe("June Park");
    expect(unmatched.city).toBe("Norfolk");
    expect(unmatched.state).toBe("VA");
    expect(unmatched.hot).toBe(false);

    const hot = contacted.find((c) => c.refId === "LD-26-80902")!;
    expect(hot.partner).toEqual({ name: "Other Partner", refId: "JV-802", color: "#2E7D5B" });
    expect(hot.hot).toBe(true);
    expect(hot.scoreTotal).toBe(41);

    // statusSince = the latest status row for a moved lead…
    expect(new Date(hot.statusSince).getTime()).toBeGreaterThan(T0 - 60 * MIN);
    // …and the lead's own createdAt for one that never moved.
    const newest = col(b, "New").cards[0];
    expect(new Date(newest.statusSince).toISOString()).toBe(newest.statusSince);
  });

  it("KAN-02: cards are ordered by last status change, newest first", async () => {
    const refs = col(await board(), "New").cards.map((c) => c.refId);
    // The seed's createdAt DESCENDS as the ref number ascends, so "newest first"
    // is exactly the 25 lowest ref numbers, in order.
    expect(refs).toEqual(Array.from({ length: 25 }, (_, i) => `LD-26-80${100 + i}`));
  });

  it("TST-01/PRN-08: another tenant's lead never appears, even in the same column", async () => {
    const b = await board();
    expect(b.columns.flatMap((c) => c.cards.map((x) => x.refId))).not.toContain("LD-26-80999");
    expect(col(b, "Appointment").total).toBe(1); // not 2 — B's Appointment lead is out of scope
  });

  it("R-65: a lead pointing at ANOTHER tenant's partner renders unmatched — never that partner's name or colour", async () => {
    const cross = col(await board(), "Closed").cards.find((c) => c.refId === "LD-26-80905")!;
    expect(cross).toBeDefined(); // the lead itself is A's, so it stays on A's board…
    expect(cross.partner).toBeNull(); // …but the foreign partner resolves to NULL (join tenant predicate)
    expect(JSON.stringify(cross)).not.toContain("Foreign Partner");
    expect(JSON.stringify(cross)).not.toContain("JV-899");
    expect(JSON.stringify(cross)).not.toContain("#B23A48");
  });

  it("PRN-08 (BOLA): a partnerId belonging to ANOTHER tenant filters to nothing — indistinguishable from an empty in-tenant partner", async () => {
    // Probed with the UNREFERENCED foreign partner. The filter is `leadWhere(scope) AND
    // partnerOwnsLead(id)`, so a foreign id can only ever match the caller's OWN rows —
    // and it matches none unless one of them carries a mis-set FK (the R-65 fixture above,
    // which is still the tenant's own lead and still renders no foreign partner).
    const foreign = await board({ partnerId: id.partnerB2 });
    expect(foreign.columns.map((c) => c.status)).toHaveLength(6);
    expect(foreign.columns.every((c) => c.total === 0 && c.cards.length === 0)).toBe(true);

    // The same shape an in-tenant partner with no leads produces — no oracle for "does
    // this id exist in another tenant?".
    const [emptyPartner] = await db
      .insert(schema.partners)
      .values({ tenantId: id.tenantA, refId: "JV-803", name: "Empty Partner", color: "#123456", status: "active" })
      .returning({ id: schema.partners.id });
    const empty = await board({ partnerId: emptyPartner.id });
    expect(empty.columns).toEqual(foreign.columns);
  });

  it("TST-01: the reverse probe — tenant B's board holds only B's own lead", async () => {
    const bBoard = await listLeadsBoard({ tenantId: id.tenantB, role: "admin", userId: id.adminB }, BoardQuerySchema.parse({}));
    expect(bBoard.columns.flatMap((c) => c.cards.map((x) => x.refId))).toEqual(["LD-26-80999"]);
    expect(bBoard.columns.reduce((n, c) => n + c.total, 0)).toBe(1);
  });

  it("KAN-03: the card payload shape is locked — no field rides along silently", async () => {
    const anyCard = col(await board(), "New").cards[0];
    expect(Object.keys(anyCard).sort()).toEqual(
      // TAG-04 added `tags` (the card's chips) — the only field this WP put on a card.
      ["city", "hot", "partner", "refId", "scoreTotal", "seller", "state", "statusSince", "tags"],
    );
  });

  it("KAN-02: a partner scope is refused by the module itself, not just the route (R-22 author scope is missing here)", async () => {
    await expect(
      listLeadsBoard({ tenantId: id.tenantA, role: "partner", partnerId: id.partnerA, userId: partnerUserId }, BoardQuerySchema.parse({})),
    ).rejects.toThrow(/admin-only/i);
  });

  it("KAN-08: a non-column status param (incl. the read-only 'Removed MLS' verdict) degrades to the full board", async () => {
    for (const status of ["Removed MLS", "New ", "nonsense", ""]) {
      const b = await board({ status });
      expect(b.columns.map((c) => c.status), `status=${status}`).toEqual([...BOARD_COLUMNS]);
      // "Removed MLS" can never become a seventh column.
      expect(b.columns.map((c) => c.status)).not.toContain("Removed MLS");
    }
  });

  it("KAN-02: `page` without `status` is normalized away — page 1 of every column, not an offset board", async () => {
    const deep = await board({ page: "3" });
    expect(deep.columns.every((c) => c.page === 1)).toBe(true);
    expect(col(deep, "New").cards).toHaveLength(25);
    expect(col(deep, "New").cards.map((c) => c.refId)).toEqual(col(await board(), "New").cards.map((c) => c.refId));
  });

  it("KAN-02: an absurd page clamps instead of erroring — 200 with empty slices and true totals", async () => {
    const huge = await board({ status: "New", page: "1e308" });
    expect(huge.columns[0].cards).toEqual([]);
    expect(huge.columns[0].total).toBe(26);
    expect(huge.columns[0].page).toBeLessThanOrEqual(10_000);

    const res = await getBoard(jsonRequest("GET", "/api/leads/board?status=New&page=1e308"));
    expect(res.status).toBe(200);
  });

  it("KAN-09: the partner and hot filters narrow every column", async () => {
    const mine = await board({ partnerId: id.partnerA2 });
    expect(mine.columns.flatMap((c) => c.cards.map((x) => x.refId))).toEqual(["LD-26-80902"]);
    expect(col(mine, "New").total).toBe(0);

    const unmatchedOnly = await board({ partnerId: "unmatched" });
    expect(unmatchedOnly.columns.flatMap((c) => c.cards.map((x) => x.refId))).toEqual(["LD-26-80901"]);

    const hot = await board({ hot: "1" });
    expect(hot.columns.flatMap((c) => c.cards.map((x) => x.refId))).toEqual(["LD-26-80902"]);
    expect(col(hot, "Contacted").total).toBe(1);
  });

  it("KAN-02: GET /api/leads/board returns 200 with the board payload and degrades bad params", async () => {
    const res = await getBoard(jsonRequest("GET", "/api/leads/board"));
    expect(res.status).toBe(200);
    const payload = await body(res);
    expect((payload.columns as unknown[]).length).toBe(6);

    // Nonsense params degrade to the default board instead of 400-ing.
    const degraded = await body(await getBoard(jsonRequest("GET", "/api/leads/board?status=Nonsense&page=abc&partnerId=drop")));
    expect((degraded.columns as { status: string }[]).map((c) => c.status)).toHaveLength(6);
    expect((degraded.columns as { page: number }[])[0].page).toBe(1);
  });

  it("KAN-02: the board is admin-gated — a partner caller gets 403, no session 401", async () => {
    try {
      setRouteScope({ tenantId: id.tenantA, role: "partner", partnerId: id.partnerA, userId: partnerUserId });
      const forbidden = await getBoard(jsonRequest("GET", "/api/leads/board"));
      expect(forbidden.status).toBe(403);
      const env = await body(forbidden);
      expect(env.code).toBe("forbidden");
      expect(env.traceId).toEqual(expect.any(String)); // uniform envelope

      setRouteScope(null);
      const anon = await getBoard(jsonRequest("GET", "/api/leads/board"));
      expect(anon.status).toBe(401);
      expect((await body(anon)).code).toBe("unauthenticated");
    } finally {
      setRouteScope(adminScope(id.tenantA, adminUserId));
    }
  });

  it("KAN-04: a status change through the existing command moves the card between columns", async () => {
    await updateLeadStatus(scopeA(), "LD-26-80901", "Under contract");
    try {
      const b = await board();
      expect(col(b, "Under contract").cards.map((c) => c.refId)).toEqual(["LD-26-80901"]);
      expect(col(b, "Contacted").cards.map((c) => c.refId)).not.toContain("LD-26-80901");
      expect(col(b, "Contacted").total).toBe(1);
    } finally {
      await updateLeadStatus(scopeA(), "LD-26-80901", "Contacted"); // restore for later runs
    }
  });
});
