import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { globalSearch, SearchScopeError } from "@/modules/search/queries";
import { SEARCH_MAX_CHARS } from "@/modules/search/schema";
import { normalizePhone } from "@/modules/pipeline/normalize";
import type { ScopeContext } from "@/lib/scope";
import { adminScope, routeParams, scopeContextMock, setRouteScope } from "./_route-harness";
import type * as ScopeContextModule from "@/lib/scope-context";

// getServerScope is injected at its module seam so the route runs without a live
// Supabase session (see _route-harness); the DB, the Zod contract and the query layer
// all stay real.
vi.mock("@/lib/scope-context", async (orig) =>
  scopeContextMock(await orig<typeof ScopeContextModule>()),
);

// Imported after the mock is registered (Vitest hoists vi.mock above imports).
import { GET } from "@/app/api/search/route";
import { GET as GET_LEAD } from "@/app/api/leads/[ref]/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG_A = "test-search-a";
const SLUG_B = "test-search-b";

// Tenant A's fixtures.
const REF_MARCUS = "LD-26-70001"; // Whitfield, Marcus · Phoenix AZ · (602) 555-0148 · HOT
const REF_JANET = "LD-26-70002"; // Whitfield, Janet · Norfolk VA
const REF_REMOVED = "LD-26-70003"; // Kim · 88 N Fontana Ave · MLS-removed (still findable)
const REF_RECALLED = "LD-26-70004"; // Whitfield, Gone · recalled (soft-deleted) → never findable
const REF_PERCENT = "LD-26-70005"; // 100% Ranch Rd — the ILIKE-metacharacter fixture
const REF_ASSIGNED = "LD-26-70006"; // owned by a partner (the search path must cover owned leads)
const REF_ASSIGNED_GONE = "LD-26-70007"; // owned AND recalled — excluded like any other recall
const REF_UNDERSCORE = "LD-26-70008"; // "APT_5" — the literal-underscore fixture
const REF_UNDERSCORE_DECOY = "LD-26-70009"; // "APTX5" — matches ONLY if `_` stays a wildcard
const REF_B_LEAK = "LD-26-80001"; // Tenant B's Whitfield — the cross-tenant probe

const ids: Record<string, string> = {};

async function seed(db: PostgresJsDatabase<typeof schema>) {
  const [tA] = await db.insert(schema.tenants).values({ name: "Search A", slug: SLUG_A }).returning({ id: schema.tenants.id });
  const [tB] = await db.insert(schema.tenants).values({ name: "Search B", slug: SLUG_B }).returning({ id: schema.tenants.id });
  ids.tenantA = tA.id;
  ids.tenantB = tB.id;

  const [upA] = await db.insert(schema.uploads).values({ tenantId: tA.id, refId: "IM-26-701", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
  const [upB] = await db.insert(schema.uploads).values({ tenantId: tB.id, refId: "IM-26-801", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });

  // Partners. A's "Cedar Ridge" and B's identically-named partner make the tenant probe
  // real: a name match alone would leak B's row into A's results.
  const [pA] = await db
    .insert(schema.partners)
    .values({ tenantId: tA.id, refId: "PR-004", name: "Cedar Ridge Capital", email: "ops@cedarridge.test", color: "#2F6DB0", status: "active" })
    .returning({ id: schema.partners.id });
  ids.partnerA = pA.id;
  const [pRevoked] = await db
    .insert(schema.partners)
    .values({ tenantId: tA.id, refId: "PR-007", name: "Sunline Homes", email: "hi@sunline.test", color: "#A96C11", status: "revoked" })
    .returning({ id: schema.partners.id });
  ids.partnerRevoked = pRevoked.id;
  const [pDeleted] = await db
    .insert(schema.partners)
    .values({ tenantId: tA.id, refId: "PR-009", name: "Sunline Legacy", email: "old@sunline.test", color: "#B23A48", status: "active", deletedAt: new Date() })
    .returning({ id: schema.partners.id });
  ids.partnerDeleted = pDeleted.id;
  const [pB] = await db
    .insert(schema.partners)
    .values({ tenantId: tB.id, refId: "PR-004", name: "Cedar Ridge Capital", email: "ops@cedarridge-b.test", color: "#2F6DB0", status: "active" })
    .returning({ id: schema.partners.id });
  ids.partnerB = pB.id;

  const lead = (
    tenantId: string,
    uploadId: string,
    v: Partial<typeof schema.leads.$inferInsert> & { refId: string },
  ): typeof schema.leads.$inferInsert => ({
    tenantId,
    uploadId,
    dedupeKey: randomUUID(),
    rawJson: {},
    mlsStatus: "kept" as const,
    matchMethod: "none" as const,
    ...v,
  });

  await db.insert(schema.leads).values([
    lead(tA.id, upA.id, {
      refId: REF_MARCUS, sellerFirst: "Marcus", sellerLast: "Whitfield",
      address: "4127 E Cactus Wren Dr", city: "Phoenix", state: "AZ", zip: "85028",
      phone: "(602) 555-0148", phoneNorm: normalizePhone("(602) 555-0148"),
      scoreGroup: "hot", scoreTotal: 42, scoreStatus: "complete",
      createdAt: new Date(Date.now() - 10_000),
    }),
    lead(tA.id, upA.id, {
      refId: REF_JANET, sellerFirst: "Janet", sellerLast: "Whitfield",
      address: "9 Elm Ct", city: "Norfolk", state: "VA", createdAt: new Date(Date.now() - 20_000),
    }),
    lead(tA.id, upA.id, {
      refId: REF_REMOVED, sellerFirst: "Dolores", sellerLast: "Kim",
      address: "88 N Fontana Ave", city: "Tucson", state: "AZ",
      mlsStatus: "removed", mlsReason: "Listed with an agent", createdAt: new Date(Date.now() - 30_000),
    }),
    lead(tA.id, upA.id, {
      refId: REF_RECALLED, sellerFirst: "Gone", sellerLast: "Whitfield",
      address: "1 Recalled Way", city: "Phoenix", state: "AZ",
      phoneNorm: normalizePhone("(602) 555-0148"),
      deletedAt: new Date(), createdAt: new Date(Date.now() - 40_000),
    }),
    lead(tA.id, upA.id, {
      refId: REF_PERCENT, sellerFirst: "Percy", sellerLast: "Signum",
      address: "100% Ranch Rd", city: "Mesa", state: "AZ", createdAt: new Date(Date.now() - 50_000),
    }),
    // A partner-OWNED lead (and its recalled twin): the search path must cover leads with
    // an effective owner, not just unmatched ones.
    lead(tA.id, upA.id, {
      refId: REF_ASSIGNED, sellerFirst: "Owen", sellerLast: "Assigndon",
      address: "12 Owned St", city: "Gilbert", state: "AZ", zip: "85233",
      partnerId: pA.id, matchMethod: "zip", matchedOn: "85233",
      createdAt: new Date(Date.now() - 51_000),
    }),
    lead(tA.id, upA.id, {
      refId: REF_ASSIGNED_GONE, sellerFirst: "Olive", sellerLast: "Assigndon",
      address: "14 Owned St", city: "Gilbert", state: "AZ", zip: "85233",
      partnerId: pA.id, matchMethod: "zip", matchedOn: "85233",
      deletedAt: new Date(), createdAt: new Date(Date.now() - 52_000),
    }),
    // Literal-underscore pair: "APT_5" matches q="t_5" only when `_` is escaped; "APTX5"
    // matches only when it is NOT (i.e. it is the canary for a leaked wildcard).
    lead(tA.id, upA.id, {
      refId: REF_UNDERSCORE, sellerFirst: "Una", sellerLast: "Score",
      address: "APT_5 Real Rd", city: "Sedona", state: "AZ", createdAt: new Date(Date.now() - 53_000),
    }),
    lead(tA.id, upA.id, {
      refId: REF_UNDERSCORE_DECOY, sellerFirst: "Dee", sellerLast: "Coy",
      address: "APTX5 Decoy Rd", city: "Sedona", state: "AZ", createdAt: new Date(Date.now() - 54_000),
    }),
    // 11 matches for the per-group cap (SRCH-01: limit 10, true total reported).
    ...Array.from({ length: 11 }, (_, i) =>
      lead(tA.id, upA.id, {
        refId: `LD-26-71${String(i).padStart(3, "0")}`,
        sellerFirst: "Cap", sellerLast: `Row${i}`,
        address: `${i} Limitville Ln`, city: "Limitville", state: "TX",
        createdAt: new Date(Date.now() - 60_000 - i * 1_000),
      }),
    ),
    // Tenant B — same seller surname and the same phone digits as A's lead.
    lead(tB.id, upB.id, {
      refId: REF_B_LEAK, sellerFirst: "Other", sellerLast: "Whitfield",
      address: "4127 E Cactus Wren Dr", city: "Phoenix", state: "AZ",
      phoneNorm: normalizePhone("(602) 555-0148"),
    }),
  ]);
}

suite("SRCH: globalSearch (SRCH-01)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    await seed(db);
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const scopeA = (): ScopeContext => ({ tenantId: ids.tenantA, role: "admin", userId: randomUUID() });
  const scopeB = (): ScopeContext => ({ tenantId: ids.tenantB, role: "admin", userId: randomUUID() });
  const refs = (r: { leads: { rows: { refId: string }[] } }) => r.leads.rows.map((l) => l.refId);

  it("SRCH-01: tenant probe — A's search never returns B's lead or B's identically-named partner (PRN-08)", async () => {
    const a = await globalSearch(scopeA(), "whitf");
    expect(refs(a)).toContain(REF_MARCUS);
    expect(refs(a)).toContain(REF_JANET);
    expect(refs(a)).not.toContain(REF_B_LEAK);
    expect(a.leads.total).toBe(2); // Marcus + Janet; the recalled Whitfield is not counted

    const partners = await globalSearch(scopeA(), "cedar");
    expect(partners.partners.rows.map((p) => p.id)).toEqual([ids.partnerA]);
    expect(partners.partners.rows.map((p) => p.id)).not.toContain(ids.partnerB);
    // The TOTAL is scoped too, not just the rows — a leak would show up as a count of 2
    // even while the capped row list looked clean.
    expect(partners.partners.total).toBe(1);

    // And the mirror: B sees only its own.
    const b = await globalSearch(scopeB(), "whitf");
    expect(refs(b)).toEqual([REF_B_LEAK]);
  });

  it("SRCH-01: a formatted phone query finds the lead through phone_norm", async () => {
    const byFormatted = await globalSearch(scopeA(), "(602) 555-0148");
    expect(refs(byFormatted)).toEqual([REF_MARCUS]);

    // A partial, differently-formatted fragment reaches the same lead.
    const byFragment = await globalSearch(scopeA(), "602-555");
    expect(refs(byFragment)).toContain(REF_MARCUS);

    // Below the digit floor, digits are NOT matched against phone numbers — "602" would
    // otherwise sweep in every phone containing that run.
    const tooShort = await globalSearch(scopeA(), "602");
    expect(refs(tooShort)).not.toContain(REF_MARCUS);
  });

  it("SRCH-01: the reference ID matches, case-insensitively and by fragment", async () => {
    expect(refs(await globalSearch(scopeA(), REF_JANET))).toEqual([REF_JANET]);
    expect(refs(await globalSearch(scopeA(), "ld-26-70002"))).toEqual([REF_JANET]);
  });

  it("SRCH-01: address and city match case-insensitively", async () => {
    expect(refs(await globalSearch(scopeA(), "cactus wren"))).toEqual([REF_MARCUS]);
    expect(refs(await globalSearch(scopeA(), "norfolk"))).toEqual([REF_JANET]);
  });

  it("SRCH-01: an MLS-REMOVED lead is still findable, and carries its verdict", async () => {
    const res = await globalSearch(scopeA(), "fontana");
    expect(refs(res)).toEqual([REF_REMOVED]);
    expect(res.leads.rows[0].mlsStatus).toBe("removed");
    expect(res.leads.rows[0].status).toBe("Removed MLS");
    // A removed lead never wears the Hot mark, whatever its score.
    expect(res.leads.rows[0].hot).toBe(false);
  });

  it("SRCH-01: a RECALLED (soft-deleted) lead is never returned — by name, address, or phone", async () => {
    expect(refs(await globalSearch(scopeA(), "whitf"))).not.toContain(REF_RECALLED);
    expect(refs(await globalSearch(scopeA(), "recalled way"))).toEqual([]);
    expect(refs(await globalSearch(scopeA(), "(602) 555-0148"))).not.toContain(REF_RECALLED);
  });

  it("SRCH-01: a partner-OWNED lead is findable; its recalled twin is not", async () => {
    const res = await globalSearch(scopeA(), "assigndon");
    expect(refs(res)).toEqual([REF_ASSIGNED]);
    expect(res.leads.total).toBe(1);
    expect(refs(res)).not.toContain(REF_ASSIGNED_GONE);
  });

  it("SRCH-01: ZIP matches, in parity with the leads list's own q filter", async () => {
    const res = await globalSearch(scopeA(), "85233");
    expect(refs(res)).toEqual([REF_ASSIGNED]); // the recalled twin shares the ZIP
    expect(refs(await globalSearch(scopeA(), "85028"))).toEqual([REF_MARCUS]);
  });

  it("SRCH-01: a PARTNER scope is refused by the MODULE, not just the route (defence in depth)", async () => {
    const partnerScope: ScopeContext = {
      tenantId: ids.tenantA,
      role: "partner",
      partnerId: ids.partnerA,
      userId: randomUUID(),
    };
    await expect(globalSearch(partnerScope, "whitf")).rejects.toThrow(SearchScopeError);
    // And it refuses BEFORE the min-length short-circuit — the guard is not skippable
    // by sending a query that would have returned an empty result anyway.
    await expect(globalSearch(partnerScope, "w")).rejects.toThrow(SearchScopeError);
  });

  it("SRCH-01: a query below the minimum length short-circuits to an empty result", async () => {
    for (const q of ["", " ", "w"]) {
      const res = await globalSearch(scopeA(), q);
      expect(res.leads).toEqual({ total: 0, rows: [] });
      expect(res.partners).toEqual({ total: 0, rows: [] });
    }
    // Two characters DO search.
    expect((await globalSearch(scopeA(), "wh")).leads.total).toBeGreaterThan(0);
  });

  it("SRCH-01: each group is capped at 10 rows while the true total is reported", async () => {
    const res = await globalSearch(scopeA(), "Limitville");
    expect(res.leads.rows).toHaveLength(10);
    expect(res.leads.total).toBe(11);
  });

  it("SRCH-01: ILIKE metacharacters are escaped — '%' matches a literal percent, not everything", async () => {
    const literal = await globalSearch(scopeA(), "0%");
    expect(refs(literal)).toEqual([REF_PERCENT]);
    expect(literal.leads.total).toBe(1);

    // The wildcard pair no lead literally contains: escaped it matches nothing; unescaped
    // it would match every row in the tenant.
    const wildcards = await globalSearch(scopeA(), "%_");
    expect(wildcards.leads.total).toBe(0);
    expect(wildcards.partners.total).toBe(0);
  });

  it("SRCH-01: `_` is a LITERAL — 't_5' finds APT_5 and never the APTX5 decoy", async () => {
    const res = await globalSearch(scopeA(), "t_5");
    expect(refs(res)).toEqual([REF_UNDERSCORE]);
    expect(refs(res)).not.toContain(REF_UNDERSCORE_DECOY);
    expect(res.leads.total).toBe(1);
  });

  it("SRCH-01: a query carrying the escape character itself runs clean (no driver error)", async () => {
    // "a\" — the escape char in the LAST position is the classic way to produce an
    // invalid pattern if the escaping is done naively.
    const trailing = await globalSearch(scopeA(), "a\\");
    expect(trailing.leads.total).toBe(0);
    const doubled = await globalSearch(scopeA(), "\\\\");
    expect(doubled.leads.total).toBe(0);
    expect(doubled.partners.total).toBe(0);
  });

  it("SRCH-01: the payload carries the list's fields — and no seller phone or email (SRCH-04)", async () => {
    const res = await globalSearch(scopeA(), "cactus wren");
    const row = res.leads.rows[0];
    expect(row).toEqual({
      refId: REF_MARCUS,
      seller: "Marcus Whitfield",
      address: "4127 E Cactus Wren Dr",
      city: "Phoenix",
      state: "AZ",
      status: "New",
      mlsStatus: "kept",
      hot: true,
      scoreTotal: 42,
    });
    expect(Object.keys(row)).not.toContain("phone");
    expect(Object.keys(row)).not.toContain("email");
  });

  it("SRCH-01: partners match on name/ref/email; revoked and deleted partners are excluded", async () => {
    expect((await globalSearch(scopeA(), "PR-004")).partners.rows.map((p) => p.id)).toEqual([ids.partnerA]);
    const byEmail = await globalSearch(scopeA(), "ops@cedarridge.test");
    expect(byEmail.partners.rows.map((p) => p.id)).toEqual([ids.partnerA]);
    // The matched field is IN the payload, so the overlay can show why the row hit.
    expect(byEmail.partners.rows[0]).toEqual({
      id: ids.partnerA,
      name: "Cedar Ridge Capital",
      refId: "PR-004",
      color: "#2F6DB0",
      email: "ops@cedarridge.test",
    });

    const sunline = await globalSearch(scopeA(), "sunline");
    expect(sunline.partners.rows).toEqual([]);
    expect(sunline.partners.total).toBe(0);
  });
});

suite("SRCH: GET /api/search — admin gate + envelope (SRCH-01/04)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;

  const SLUG_R = "test-search-route";
  const SLUG_R2 = "test-search-route-other"; // the OTHER tenant, for the deep-link probe
  const REF_ROUTE = "LD-26-72001";
  const REF_OTHER = "LD-26-73001";

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG_R, SLUG_R2]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Search Route", slug: SLUG_R }).returning({ id: schema.tenants.id });
    ids.tenantR = t.id;
    const [p] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "PR-001", name: "Routebound Partners", color: "#2F6DB0", status: "active" })
      .returning({ id: schema.partners.id });
    ids.partnerR = p.id;
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-720", filename: "r.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({
      tenantId: t.id, uploadId: up.id, refId: REF_ROUTE, dedupeKey: randomUUID(), rawJson: {},
      mlsStatus: "kept", matchMethod: "none", sellerFirst: "Routa", sellerLast: "Bellweather", address: "5 Route Way", city: "Austin", state: "TX",
    });

    // A SECOND tenant holding a lead with the same seller surname — the target of the
    // deep-link probe below (?open=<ref> must not resolve across tenants).
    const [t2] = await db.insert(schema.tenants).values({ name: "Search Route Other", slug: SLUG_R2 }).returning({ id: schema.tenants.id });
    ids.tenantR2 = t2.id;
    const [up2] = await db.insert(schema.uploads).values({ tenantId: t2.id, refId: "IM-26-730", filename: "o.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    await db.insert(schema.leads).values({
      tenantId: t2.id, uploadId: up2.id, refId: REF_OTHER, dedupeKey: randomUUID(), rawJson: {},
      mlsStatus: "kept", matchMethod: "none", sellerFirst: "Otto", sellerLast: "Bellweather", address: "5 Other Way", city: "Austin", state: "TX",
    });
  });

  afterAll(async () => {
    setRouteScope(null);
    await cleanup();
    await client.end();
  });

  const call = (q: string) => GET(new Request(`http://localhost:3000/api/search?q=${encodeURIComponent(q)}`));

  it("SRCH-01: an admin gets 200 with both groups", async () => {
    setRouteScope(adminScope(ids.tenantR));
    const res = await call("bellweather");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.q).toBe("bellweather");
    expect(body.leads.rows.map((l: { refId: string }) => l.refId)).toEqual([REF_ROUTE]);
    expect(body.partners).toEqual({ total: 0, rows: [] });
  });

  it("SRCH-01: a PARTNER session is refused with the uniform 403 envelope (admin-only)", async () => {
    setRouteScope({ tenantId: ids.tenantR, role: "partner", partnerId: ids.partnerR, userId: randomUUID() });
    const res = await call("bellweather");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("forbidden");
    expect(body.traceId).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(REF_ROUTE);
  });

  it("SRCH-01: an UNAUTHENTICATED caller gets the uniform 401 envelope", async () => {
    setRouteScope(null);
    const res = await call("bellweather");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("unauthenticated");
    expect(body.traceId).toBeTruthy();
  });

  it("SRCH-01: a too-short or missing q is a 200 empty result, never a 400", async () => {
    setRouteScope(adminScope(ids.tenantR));
    const short = await call("b");
    expect(short.status).toBe(200);
    expect(await short.json()).toEqual({ q: "b", leads: { total: 0, rows: [] }, partners: { total: 0, rows: [] } });

    const missing = await GET(new Request("http://localhost:3000/api/search"));
    expect(missing.status).toBe(200);
    expect((await missing.json()).leads.total).toBe(0);
  });

  it("SRCH-01: the boundary NORMALIZES q — padding is trimmed and the echo is the sent term", async () => {
    setRouteScope(adminScope(ids.tenantR));
    const padded = await call("  bellweather  ");
    expect(padded.status).toBe(200);
    const body = await padded.json();
    // The echoed q is what the client must compare against to accept the payload — it is
    // the NORMALIZED term, not the raw parameter.
    expect(body.q).toBe("bellweather");
    expect(body.leads.rows.map((l: { refId: string }) => l.refId)).toEqual([REF_ROUTE]);

    // An over-long paste is capped rather than rejected, and still answers 200.
    const long = await call("z".repeat(200));
    expect(long.status).toBe(200);
    const longBody = await long.json();
    expect(longBody.q).toHaveLength(SEARCH_MAX_CHARS);
    expect(longBody.leads.total).toBe(0);
  });

  it("SRCH-01: the ?open= deep link this WP produces does NOT resolve across tenants", async () => {
    // The overlay's lead rows navigate to /leads?open=<ref>, which the page resolves via
    // GET /api/leads/<ref>. A ref guessed (or carried) from another workspace must 404,
    // not render — the search payload is scoped, and so is the surface it links to.
    setRouteScope(adminScope(ids.tenantR));
    const own = await GET_LEAD(new Request(`http://localhost:3000/api/leads/${REF_ROUTE}`), routeParams({ ref: REF_ROUTE }));
    expect(own.status).toBe(200);

    const foreign = await GET_LEAD(new Request(`http://localhost:3000/api/leads/${REF_OTHER}`), routeParams({ ref: REF_OTHER }));
    expect(foreign.status).toBe(404);
    const body = await foreign.json();
    expect(body.code).toBe("not_found");
    expect(JSON.stringify(body)).not.toContain("Otto");
  });
});
