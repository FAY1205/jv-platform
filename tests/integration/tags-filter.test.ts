import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { listLeads, listLeadsBoard } from "@/modules/leads/queries";
import { LeadsQuerySchema, BoardQuerySchema } from "@/modules/leads/schema";
import { createTag, attachTag } from "@/modules/tags/tags";
import { purgeAuditLog } from "../helpers/audit";

// WP-TAG-1 / TAG-03 — the `?tags=` filter on BOTH the list and the board: any-of semantics,
// combination with the partner + hot filters, correct TOTALS (the EXISTS predicate must not
// multiply a lead carrying two selected tags), and the payload-shape lock on the new `tags`
// field both endpoints now return. Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-tags-filter";

// A · hot, partner P — Probate + Follow-up   B · partner P — Probate
// C · hot, partner Q — Follow-up             D · unmatched — no tags
const REFS = { a: "LD-26-40001", b: "LD-26-40002", c: "LD-26-40003", d: "LD-26-40004" };

suite("TAG-03: the tags filter on the leads list and board", () => {
  let db: ReturnType<typeof getDb>;
  let scope: ScopeContext;
  const adminUserId = randomUUID();
  const id: Record<string, string> = {};

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
    const [t] = await db.insert(schema.tenants).values({ name: "Tags Filter", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: adminUserId };
    await db.insert(schema.users).values({ id: adminUserId, tenantId: t.id, email: "admin@tags-filter.test", role: "admin" });
    const [p] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-401", name: "P", color: "#111", status: "active" }).returning({ id: schema.partners.id });
    const [q] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-402", name: "Q", color: "#222", status: "active" }).returning({ id: schema.partners.id });
    id.p = p.id;
    id.q = q.id;
    const [u] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-401", filename: "x.csv", status: "processed" }).returning({ id: schema.uploads.id });

    const base = { tenantId: t.id, uploadId: u.id, rawJson: {}, mlsStatus: "kept" as const, matchMethod: "zip" as const };
    await db.insert(schema.leads).values([
      { ...base, refId: REFS.a, dedupeKey: randomUUID(), partnerId: p.id, scoreGroup: "hot", scoreTotal: 41, scoreStatus: "complete" },
      { ...base, refId: REFS.b, dedupeKey: randomUUID(), partnerId: p.id },
      { ...base, refId: REFS.c, dedupeKey: randomUUID(), partnerId: q.id, scoreGroup: "hot", scoreTotal: 44, scoreStatus: "complete" },
      { ...base, refId: REFS.d, dedupeKey: randomUUID(), matchMethod: "none" },
    ]);

    const probate = await createTag(scope, { name: "Probate", color: "teal" });
    const followUp = await createTag(scope, { name: "Follow-up", color: "blue" });
    id.probate = probate.id;
    id.followUp = followUp.id;
    await attachTag(scope, REFS.a, probate.id);
    await attachTag(scope, REFS.a, followUp.id);
    await attachTag(scope, REFS.b, probate.id);
    await attachTag(scope, REFS.c, followUp.id);
  });

  afterAll(async () => {
    await cleanup();
  });

  const list = (params: Record<string, string>) => listLeads(scope, LeadsQuerySchema.parse(params));
  const board = (params: Record<string, string>) => listLeadsBoard(scope, BoardQuerySchema.parse(params));
  /** Every card on the board, flattened — the board buckets by status, which this suite
   *  doesn't vary (all four leads sit in the default "New" column). */
  const boardRefs = async (params: Record<string, string>) =>
    (await board(params)).columns.flatMap((c) => c.cards.map((card) => card.refId)).sort();
  const boardTotal = async (params: Record<string, string>) =>
    (await board(params)).columns.reduce((n, c) => n + c.total, 0);

  it("TAG-03: one tag filters the LIST to the leads carrying it, with a matching total", async () => {
    const res = await list({ tags: id.probate });
    expect(res.leads.map((l) => l.refId).sort()).toEqual([REFS.a, REFS.b]);
    expect(res.total).toBe(2);
  });

  it("TAG-03: several tags are OR / any-of — and a lead carrying BOTH is counted ONCE", async () => {
    // The regression this pins: a JOIN-based filter would return A twice and report total 4.
    const res = await list({ tags: `${id.probate},${id.followUp}` });
    expect(res.leads.map((l) => l.refId).sort()).toEqual([REFS.a, REFS.b, REFS.c]);
    expect(res.total).toBe(3);
  });

  it("TAG-03: the tag filter ANDs with the partner and hot filters", async () => {
    expect((await list({ tags: id.probate, partnerId: id.p })).leads.map((l) => l.refId).sort()).toEqual([REFS.a, REFS.b]);
    expect((await list({ tags: id.probate, partnerId: id.q })).leads).toHaveLength(0);
    // hot ∩ Follow-up = A and C; hot ∩ Probate = A only.
    expect((await list({ tags: id.followUp, hot: "1" })).leads.map((l) => l.refId).sort()).toEqual([REFS.a, REFS.c]);
    expect((await list({ tags: id.probate, hot: "1" })).leads.map((l) => l.refId)).toEqual([REFS.a]);
  });

  it("TAG-03: a malformed or unknown tag id degrades rather than 400-ing", async () => {
    // Garbage is dropped by the shared parser → no filter at all (the house rule).
    expect((await list({ tags: "not-a-uuid" })).total).toBe(4);
    // A well-formed id nobody owns matches nothing — it is NOT ignored.
    expect((await list({ tags: randomUUID() })).total).toBe(0);
  });

  it("TAG-03: the same filter applies to the BOARD — cards AND per-column totals", async () => {
    expect(await boardRefs({ tags: id.probate })).toEqual([REFS.a, REFS.b]);
    // The totals are computed inside the same filtered CTE, so they can't report the
    // unfiltered set (KAN-02's true-total contract).
    expect(await boardTotal({ tags: id.probate })).toBe(2);
    expect(await boardRefs({ tags: `${id.probate},${id.followUp}` })).toEqual([REFS.a, REFS.b, REFS.c]);
    expect(await boardTotal({ tags: `${id.probate},${id.followUp}` })).toBe(3);
  });

  it("TAG-03: the board combines tags with its partner + hot filters too", async () => {
    expect(await boardRefs({ tags: id.followUp, hot: "1" })).toEqual([REFS.a, REFS.c]);
    expect(await boardRefs({ tags: id.followUp, partnerId: id.q })).toEqual([REFS.c]);
    expect(await boardRefs({ tags: id.probate, partnerId: "unmatched" })).toEqual([]);
  });

  it("TAG-04: BOTH payloads carry each lead's chips, ordered by name (shape lock)", async () => {
    const row = (await list({})).leads.find((l) => l.refId === REFS.a)!;
    expect(row.tags).toEqual([
      { id: id.followUp, name: "Follow-up", color: "blue" },
      { id: id.probate, name: "Probate", color: "teal" },
    ]);
    // An untagged lead carries an empty array, never undefined — the renderer never branches.
    expect((await list({})).leads.find((l) => l.refId === REFS.d)!.tags).toEqual([]);

    const cards = (await board({})).columns.flatMap((c) => c.cards);
    expect(cards.find((c) => c.refId === REFS.a)!.tags.map((t) => t.name)).toEqual(["Follow-up", "Probate"]);
    expect(cards.find((c) => c.refId === REFS.d)!.tags).toEqual([]);
  });
});
