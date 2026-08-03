import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { countPartnerLeads, listPartnerLeads } from "@/modules/portal/queries";
import { updateLeadStatus } from "@/modules/portal/status-update";

// PW-PW-3 Task 1: tenancy-safe server-side sort + status filter on the portal
// leads query. Two partners share one tenant; every assertion proves the
// sort/filter can never surface — or even count — another partner's rows
// (PRN-08). Self-skips without a DB (mirrors the other portal-* suites).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-portal-pw3-sortfilter";

suite("WP-PW-3 Task 1: listPartnerLeads sort + status filter (PRN-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  const SLUG_T2 = "test-portal-pw3-sortfilter-t2";
  const SLUG_T3 = "test-portal-pw3-sortfilter-t3";

  async function cleanupSlugs(slugs: string[]) {
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, slugs));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  async function cleanup() {
    await cleanupSlugs([SLUG]);
  }

  // Past the distribution hold window so every seeded lead is partner-visible
  // immediately — distinct, decreasing timestamps also give a deterministic "received" order.
  function releasedAt(offsetSeconds: number): Date {
    return new Date(Date.now() - 20 * 60 * 1000 - offsetSeconds * 1000);
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();

    const [t] = await db.insert(schema.tenants).values({ name: "PW3 Sort Filter", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-301", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-302", name: "PY", color: "#222222", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.py = py.id;

    id.adminUser = randomUUID();
    id.pxUser = randomUUID();
    id.pyUser = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@pw3.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@pw3.test", role: "partner", partnerId: px.id });
    await db.insert(schema.users).values({ id: id.pyUser, tenantId: t.id, email: "py@pw3.test", role: "partner", partnerId: py.id });

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-301", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    id.upload = up.id;

    // PX's own leads: distinct cities/states, distinct createdAt for a deterministic
    // "received" order (newest first = 0s offset, oldest = highest offset).
    await db.insert(schema.leads).values([
      { tenantId: t.id, refId: "LD-26-30001", uploadId: up.id, dedupeKey: "px|1", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "A", sellerLast: "One", city: "Austin", state: "TX", createdAt: releasedAt(30) },
      { tenantId: t.id, refId: "LD-26-30002", uploadId: up.id, dedupeKey: "px|2", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "B", sellerLast: "Two", city: "Boston", state: "MA", createdAt: releasedAt(20) },
      { tenantId: t.id, refId: "LD-26-30003", uploadId: up.id, dedupeKey: "px|3", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "C", sellerLast: "Three", city: "Chicago", state: "IL", createdAt: releasedAt(10) },
    ]);
    // PY's own leads — must NEVER show up in PX's sort/filter results, even though
    // one shares the "Closed" status and a city that would sort ahead of PX's.
    await db.insert(schema.leads).values([
      { tenantId: t.id, refId: "LD-26-30004", uploadId: up.id, dedupeKey: "py|1", rawJson: {}, partnerId: py.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "D", sellerLast: "Four", city: "Aardvark City", state: "CO", createdAt: releasedAt(5) },
      { tenantId: t.id, refId: "LD-26-30005", uploadId: up.id, dedupeKey: "py|2", rawJson: {}, partnerId: py.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "E", sellerLast: "Five", city: "Evergreen", state: "CO", createdAt: releasedAt(1) },
    ]);

    const pxScope: ScopeContext = { tenantId: t.id, role: "partner", userId: id.pxUser, partnerId: px.id };
    const pyScope: ScopeContext = { tenantId: t.id, role: "partner", userId: id.pyUser, partnerId: py.id };
    // PX: Boston + Chicago → Closed, Austin stays New (default).
    await updateLeadStatus(pxScope, "LD-26-30002", "Closed");
    await updateLeadStatus(pxScope, "LD-26-30003", "Closed");
    // PY: both Closed too — the cross-partner leak PX's filter must never surface.
    await updateLeadStatus(pyScope, "LD-26-30004", "Closed");
    await updateLeadStatus(pyScope, "LD-26-30005", "Closed");
  });

  afterAll(async () => {
    await cleanup();
    await cleanupSlugs([SLUG_T2, SLUG_T3]); // safety net if a test's own try/finally didn't run
    await client.end();
  });

  const partnerX = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });

  it("PW3-01: sort=city dir=asc returns the partner's own rows in ascending city order, never the other partner's", async () => {
    const page = await listPartnerLeads(partnerX(), { sort: "city", dir: "asc" });
    expect(page.leads.map((l) => l.city)).toEqual(["Austin", "Boston", "Chicago"]);
    expect(page.leads.map((l) => l.refId)).not.toContain("LD-26-30004");
    expect(page.leads.map((l) => l.refId)).not.toContain("LD-26-30005");
  });

  it("PW3-01b: sort=city dir=desc reverses the order", async () => {
    const page = await listPartnerLeads(partnerX(), { sort: "city", dir: "desc" });
    expect(page.leads.map((l) => l.city)).toEqual(["Chicago", "Boston", "Austin"]);
  });

  it("PW3-02: statuses=['Closed'] returns only the partner's Closed leads, and total matches (count-consistency)", async () => {
    const page = await listPartnerLeads(partnerX(), { statuses: ["Closed"] });
    expect(page.leads.map((l) => l.refId).sort()).toEqual(["LD-26-30002", "LD-26-30003"]);
    expect(page.leads.every((l) => l.status === "Closed")).toBe(true);
    expect(page.total).toBe(2);
    expect(page.total).toBe(page.leads.length); // count-consistency: no js-filter-after-fetch drift
  });

  it("PP-3-01: q search matches the partner's own leads by seller/city/ref, count-consistent", async () => {
    // Seller last name "Two" → only PX's LD-26-30002.
    const bySeller = await listPartnerLeads(partnerX(), { q: "Two" });
    expect(bySeller.leads.map((l) => l.refId)).toEqual(["LD-26-30002"]);
    expect(bySeller.total).toBe(1);
    // City "Boston" → only PX's LD-26-30002.
    const byCity = await listPartnerLeads(partnerX(), { q: "boston" });
    expect(byCity.leads.map((l) => l.refId)).toEqual(["LD-26-30002"]);
    // Ref substring → LD-26-30001.
    const byRef = await listPartnerLeads(partnerX(), { q: "30001" });
    expect(byRef.leads.map((l) => l.refId)).toEqual(["LD-26-30001"]);
  });

  it("PP-3-02: q search can never reach another partner's lead (PRN-08)", async () => {
    // "Aardvark" and seller "Four" belong to PY — PX searching them finds nothing.
    expect((await listPartnerLeads(partnerX(), { q: "Aardvark" })).total).toBe(0);
    expect((await listPartnerLeads(partnerX(), { q: "Four" })).leads).toHaveLength(0);
    expect((await listPartnerLeads(partnerX(), { q: "LD-26-30004" })).total).toBe(0);
  });

  it("PW3-03: an unknown sort value falls back to received/desc, no throw", async () => {
    const baseline = await listPartnerLeads(partnerX());
    // dir intentionally omitted here: `sort` and `dir` validate independently (an unknown
    // sort degrades to "received", a missing/unknown dir degrades to "desc"), so this
    // isolates the "unknown sort" fallback rather than conflating it with an explicit dir.
    const bogus = await listPartnerLeads(partnerX(), { sort: "totally-not-a-real-field" as never });
    expect(bogus.leads.map((l) => l.refId)).toEqual(baseline.leads.map((l) => l.refId));
    // default received/desc: newest first (LD-26-30003 had the smallest offset ⇒ newest).
    expect(bogus.leads.map((l) => l.refId)).toEqual(["LD-26-30003", "LD-26-30002", "LD-26-30001"]);
  });

  it("PW3-04: a partner can never sort or filter into another partner's leads", async () => {
    const combos: { sort?: "received" | "status" | "city" | "state" | "ref"; dir?: "asc" | "desc"; statuses?: string[] }[] = [
      { sort: "city", dir: "asc" },
      { sort: "state", dir: "desc" },
      { sort: "status", dir: "asc" },
      { sort: "ref", dir: "desc" },
      { statuses: ["Closed"] },
      { sort: "city", dir: "asc", statuses: ["Closed", "New"] },
    ];
    const ownRefs = new Set(["LD-26-30001", "LD-26-30002", "LD-26-30003"]);
    // Independent scoped count via a direct DB query (no sort/filter), the ground truth
    // that any sort/status combo's result and total must stay within.
    const ownRows = await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.partnerId, id.px));
    const ownCount = ownRows.length;
    expect(ownCount).toBe(3);

    for (const opts of combos) {
      const page = await listPartnerLeads(partnerX(), opts);
      for (const l of page.leads) {
        expect(ownRefs.has(l.refId)).toBe(true);
      }
      expect(page.leads.length).toBeLessThanOrEqual(page.total);
      expect(page.total).toBeLessThanOrEqual(ownCount);
    }
  });

  it("PW3-05: sort/filter results and total exclude another TENANT's lead, even sharing status + a leading city", async () => {
    // A second tenant, entirely separate from the shared-tenant PX/PY fixtures above,
    // with a lead that shares PX's "Closed" status and a city ("Boston") that sorts
    // ahead of/alongside PX's own Boston row — the leadWhere tenant predicate (not
    // just the partner predicate) must be what keeps it out.
    await cleanupSlugs([SLUG_T2]);
    try {
      const [t2] = await db.insert(schema.tenants).values({ name: "PW3 Sort Filter T2", slug: SLUG_T2 }).returning({ id: schema.tenants.id });
      const [p2] = await db.insert(schema.partners).values({ tenantId: t2.id, refId: "JV-301", name: "P2", color: "#333333", status: "active" }).returning({ id: schema.partners.id });
      const p2User = randomUUID();
      await db.insert(schema.users).values({ id: p2User, tenantId: t2.id, email: "p2@pw3.test", role: "partner", partnerId: p2.id });
      const [up2] = await db.insert(schema.uploads).values({ tenantId: t2.id, refId: "IM-26-301", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
      await db.insert(schema.leads).values([
        { tenantId: t2.id, refId: "LD-26-40001", uploadId: up2.id, dedupeKey: "t2|1", rawJson: {}, partnerId: p2.id, matchMethod: "zip", mlsStatus: "kept", sellerFirst: "Z", sellerLast: "Other", city: "Boston", state: "MA", createdAt: releasedAt(15) },
      ]);
      const p2Scope: ScopeContext = { tenantId: t2.id, role: "partner", userId: p2User, partnerId: p2.id };
      await updateLeadStatus(p2Scope, "LD-26-40001", "Closed");

      const page = await listPartnerLeads(partnerX(), { sort: "city", dir: "asc", statuses: ["Closed"] });
      // Ground truth stays exactly PX's own two Closed leads (Boston, Chicago) — the
      // other tenant's Closed/Boston row must not appear, and must not inflate total.
      expect(page.leads.map((l) => l.refId).sort()).toEqual(["LD-26-30002", "LD-26-30003"]);
      expect(page.leads.map((l) => l.refId)).not.toContain("LD-26-40001");
      expect(page.total).toBe(2);
    } finally {
      await cleanupSlugs([SLUG_T2]);
    }
  });

  it("PW3-06: total exceeds one page under a real status filter, and a returning lead sorts by its displayed receivedAt", async () => {
    // A third, isolated tenant/partner so this doesn't disturb the fixed 3-lead PX
    // dataset the other assertions above depend on. PORTAL_PAGE_SIZES is whitelisted
    // to [10, 20, 50] (queries.ts), so proving real pagination (total > leads.length)
    // needs MORE than 10 matching rows — 11 fillers + 1 "returning" lead, all Closed.
    // The returning lead's firstMatchedAt is far OLDER than its createdAt, and its
    // createdAt is the most recent of the twelve — so a buggy sort-by-createdAt would
    // place it FIRST under received/desc, while the fix (sort by the displayed
    // coalesce(firstMatchedAt, createdAt)) places it LAST. Regression proof for Fix 1.
    await cleanupSlugs([SLUG_T3]);
    try {
      const [t3] = await db.insert(schema.tenants).values({ name: "PW3 Sort Filter T3", slug: SLUG_T3 }).returning({ id: schema.tenants.id });
      const [p3] = await db.insert(schema.partners).values({ tenantId: t3.id, refId: "JV-301", name: "P3", color: "#444444", status: "active" }).returning({ id: schema.partners.id });
      const p3User = randomUUID();
      await db.insert(schema.users).values({ id: p3User, tenantId: t3.id, email: "p3@pw3.test", role: "partner", partnerId: p3.id });
      const [up3] = await db.insert(schema.uploads).values({ tenantId: t3.id, refId: "IM-26-301", filename: "c.xlsx", status: "processed" }).returning({ id: schema.uploads.id });

      // 11 fillers, offsets 10..20 (offset 10 = newest, offset 20 = oldest of the fillers).
      const fillerOffsets = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
      const fillerLeads: (typeof schema.leads.$inferInsert)[] = fillerOffsets.map((offset, i) => ({
        tenantId: t3.id,
        refId: `LD-26-500${String(i + 1).padStart(2, "0")}`,
        uploadId: up3.id,
        dedupeKey: `t3|${i + 1}`,
        rawJson: {},
        partnerId: p3.id,
        matchMethod: "zip",
        mlsStatus: "kept",
        sellerFirst: "F",
        sellerLast: `Filler${i + 1}`,
        city: "Denver",
        state: "CO",
        createdAt: releasedAt(offset),
      }));
      const returningRef = "LD-26-50099";
      const returningLead: typeof schema.leads.$inferInsert = {
        tenantId: t3.id,
        refId: returningRef,
        uploadId: up3.id,
        dedupeKey: "t3|returning",
        rawJson: {},
        partnerId: p3.id,
        matchMethod: "zip",
        mlsStatus: "kept",
        sellerFirst: "R",
        sellerLast: "Returning",
        city: "Denver",
        state: "CO",
        // Returning lead: newest createdAt (offset 1) but a much older firstMatchedAt
        // (offset 200) — the displayed receivedAt is the firstMatchedAt.
        createdAt: releasedAt(1),
        firstMatchedAt: releasedAt(200),
        previouslyMatched: true,
      };
      await db.insert(schema.leads).values([...fillerLeads, returningLead]);
      const p3Scope: ScopeContext = { tenantId: t3.id, role: "partner", userId: p3User, partnerId: p3.id };
      const allRefs = [...fillerLeads.map((l) => l.refId), returningRef];
      for (const ref of allRefs) {
        await updateLeadStatus(p3Scope, ref, "Closed");
      }

      // Count-consistency under real pagination + status filter: total (whole filtered
      // set, 12) exceeds one page's worth of rows (pageSize 10), and every returned ref
      // is the caller's own.
      const pageOne = await listPartnerLeads(p3Scope, { statuses: ["Closed"], pageSize: 10, page: 1 });
      expect(pageOne.total).toBe(12);
      expect(pageOne.leads.length).toBe(10);
      expect(pageOne.total).toBeGreaterThan(pageOne.leads.length);
      const ownRefs = new Set(allRefs);
      for (const l of pageOne.leads) expect(ownRefs.has(l.refId)).toBe(true);

      // received/desc across the full set: the returning lead's displayed receivedAt
      // (its firstMatchedAt, offset 200 ⇒ oldest of all twelve) puts it LAST, not first
      // (which is what its createdAt, offset 1 ⇒ newest of all twelve, would have
      // produced under the pre-fix bug).
      const sorted = await listPartnerLeads(p3Scope, { sort: "received", dir: "desc", pageSize: 50 });
      expect(sorted.leads.length).toBe(12);
      expect(sorted.leads[0].refId).toBe("LD-26-50001"); // filler offset 10, the newest displayed value
      expect(sorted.leads[sorted.leads.length - 1].refId).toBe(returningRef);
    } finally {
      await cleanupSlugs([SLUG_T3]);
    }
  });

  it("F1-01: sort=status + statuses=['Closed'] returns the same scoped rows/count as the unsorted filter (WP-F1 tenant-scoped subquery is behavior-preserving)", async () => {
    const filtered = await listPartnerLeads(partnerX(), { statuses: ["Closed"] });
    const sortedFiltered = await listPartnerLeads(partnerX(), { sort: "status", dir: "asc", statuses: ["Closed"] });
    expect(sortedFiltered.leads.map((l) => l.refId).sort()).toEqual(filtered.leads.map((l) => l.refId).sort());
    expect(sortedFiltered.total).toBe(filtered.total);
    expect(sortedFiltered.total).toBe(2);
    expect(sortedFiltered.leads.every((l) => l.status === "Closed")).toBe(true);
  });

  it("T7A-01: countPartnerLeads (nav badge) matches the unfiltered list total and never counts another partner's, held, recalled, removed, or another tenant's leads", async () => {
    // Baseline: PX's badge counts exactly their 3 released leads — PY's 2 never counted.
    expect(await countPartnerLeads(partnerX())).toBe(3);

    // Exclusions the badge must never count (each direct on the COUNT path, not just
    // transitively via the list tests): a still-held lead (fresh createdAt, inside the
    // 10-min distribution hold), a soft-deleted (WP-J2 recalled) lead, a removed
    // (MLS-filtered) lead — all PX's own — and another TENANT's released kept lead.
    const SLUG_T7A = "test-portal-t7a-count-foreign";
    const [t2] = await db.insert(schema.tenants).values({ name: "T7A Count Foreign", slug: SLUG_T7A }).returning({ id: schema.tenants.id });
    const [p2] = await db.insert(schema.partners).values({ tenantId: t2.id, refId: "JV-701", name: "PF", color: "#333333", status: "active" }).returning({ id: schema.partners.id });
    const [up2] = await db.insert(schema.uploads).values({ tenantId: t2.id, refId: "IM-26-701", filename: "f.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const extra = await db
      .insert(schema.leads)
      .values([
        { tenantId: id.tenant, refId: "LD-26-30098", uploadId: id.upload, dedupeKey: "px|held", rawJson: {}, partnerId: id.px, matchMethod: "zip", mlsStatus: "kept", city: "Heldtown", state: "TX", createdAt: new Date() },
        { tenantId: id.tenant, refId: "LD-26-30099", uploadId: id.upload, dedupeKey: "px|recalled", rawJson: {}, partnerId: id.px, matchMethod: "zip", mlsStatus: "kept", city: "Gonesville", state: "TX", createdAt: releasedAt(40), deletedAt: new Date() },
        { tenantId: id.tenant, refId: "LD-26-30097", uploadId: id.upload, dedupeKey: "px|removed", rawJson: {}, partnerId: id.px, matchMethod: "zip", mlsStatus: "removed", city: "Filteredburg", state: "TX", createdAt: releasedAt(45) },
        { tenantId: t2.id, refId: "LD-26-70001", uploadId: up2.id, dedupeKey: "t7a|foreign", rawJson: {}, partnerId: p2.id, matchMethod: "zip", mlsStatus: "kept", city: "Foreignton", state: "TX", createdAt: releasedAt(50) },
      ])
      .returning({ id: schema.leads.id });
    try {
      const count = await countPartnerLeads(partnerX());
      const page = await listPartnerLeads(partnerX());
      expect(count).toBe(3); // held + recalled + removed + foreign-tenant all excluded
      expect(count).toBe(page.total); // badge ≡ list total (count-consistency, shared visibleLeadsWhere)
    } finally {
      await db.delete(schema.leads).where(inArray(schema.leads.id, extra.map((r) => r.id)));
      await cleanupSlugs([SLUG_T7A]);
    }
  });
});
