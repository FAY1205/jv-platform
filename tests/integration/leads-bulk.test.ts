import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { jsonRequest, scopeContextMock, setRouteScope } from "./_route-harness";
import { purgeAuditLog } from "../helpers/audit";

// ─────────────────────────────────────────────────────────────────────────────
// WP-N6 PR A — the three bulk write endpoints, driven over HTTP so the gates, the Zod
// boundary and the resolvers all run for real (T-1..T-6).
//
// The tenant leg is LOAD-BEARING here, not decorative (TST-01d): a SECOND tenant carries a
// lead that every filter in this suite would otherwise match, plus a ref the refs-mode tests
// name explicitly. Drop the scope conjunct from `leadsFilterConds`/`selectionConds` and the
// "never touched" assertions fail — which is the whole point of asserting them.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

import { POST as assignPost } from "@/app/api/leads/bulk/assign/route";
import { POST as statusPost } from "@/app/api/leads/bulk/status/route";
import { POST as tagsPost } from "@/app/api/leads/bulk/tags/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-leads-bulk-n6";
const OTHER_SLUG = "test-leads-bulk-n6-other";

interface Split {
  total: number;
  applied?: number;
  eligible?: number;
  skipped: Record<string, number>;
  skippedRefs?: { ref: string; reason: string }[];
}

suite("WP-N6: bulk assign / status / tags", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let scope: ScopeContext;
  let partnerA: string;
  let partnerB: string;
  let revoked: string;
  let otherPartnerId: string;
  let tagX: string;
  let otherTagId: string;
  let refs: Record<string, string>;
  let otherRef: string;

  const post = async (
    handler: (r: Request) => Promise<Response>,
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: Split & Record<string, unknown> }> => {
    const res = await handler(jsonRequest("POST", path, body));
    return { status: res.status, body: (await res.json()) as Split & Record<string, unknown> };
  };

  async function cleanup() {
    const t = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG, OTHER_SLUG]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    for (const tbl of [schema.leadTags, schema.leadStatusHistory, schema.tags, schema.leads, schema.uploads, schema.partners, schema.users]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  /** Recreate the whole fixture, so each test starts from a known board (these are WRITE
   *  tests — sharing state across them would make the numbers order-dependent). */
  async function seed() {
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Bulk N6", slug: SLUG }).returning({ id: schema.tenants.id });
    const [o] = await db.insert(schema.tenants).values({ name: "Other", slug: OTHER_SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    otherTenantId = o.id;
    scope = { tenantId, role: "admin", userId };
    // A real seat: lead_status_history.changed_by_user_id and lead_tags.added_by_user_id
    // both carry an FK to users, so the actor has to exist for the writes to land.
    await db.insert(schema.users).values({ id: userId, tenantId, email: "bulk@example.test", role: "admin" });

    const mkPartner = async (tid: string, refId: string, name: string, status: "active" | "revoked") =>
      (
        await db
          .insert(schema.partners)
          .values({ tenantId: tid, refId, name, color: "#f4c95d", status })
          .returning({ id: schema.partners.id })
      )[0].id;
    partnerA = await mkPartner(tenantId, "JV-001", "Alpha", "active");
    partnerB = await mkPartner(tenantId, "JV-002", "Bravo", "active");
    revoked = await mkPartner(tenantId, "JV-003", "Gone", "revoked");
    otherPartnerId = await mkPartner(otherTenantId, "JV-004", "Foreign", "active");

    tagX = (await db.insert(schema.tags).values({ tenantId, name: "Probate", color: "amber" }).returning({ id: schema.tags.id }))[0].id;
    otherTagId = (await db.insert(schema.tags).values({ tenantId: otherTenantId, name: "Foreign", color: "amber" }).returning({ id: schema.tags.id }))[0].id;

    const mkUpload = async (tid: string, refId: string) =>
      (
        await db
          .insert(schema.uploads)
          .values({ tenantId: tid, refId, status: "processed", filename: "x.csv" })
          .returning({ id: schema.uploads.id })
      )[0].id;
    const upload = await mkUpload(tenantId, "IM-26-801");
    const otherUpload = await mkUpload(otherTenantId, "IM-26-802");

    let n = 0;
    const mk = async (tid: string, uid: string, v: Partial<typeof schema.leads.$inferInsert>) => {
      const refId = `LD-26-8${String(n++).padStart(4, "0")}`;
      await db.insert(schema.leads).values({
        tenantId: tid,
        refId,
        uploadId: uid,
        dedupeKey: randomUUID(),
        rawJson: {},
        mlsStatus: "kept",
        matchMethod: "none",
        state: "TX",
        ...v,
      });
      return refId;
    };
    refs = {
      free: await mk(tenantId, upload, {}),
      routed: await mk(tenantId, upload, { partnerId: partnerA, matchMethod: "state_fallback", matchedOn: "TX" }),
      atA: await mk(tenantId, upload, { manualPartnerId: partnerA }),
      removed: await mk(tenantId, upload, { mlsStatus: "removed", mlsReason: "listed" }),
      contacted: await mk(tenantId, upload, {}),
    };
    // `contacted` already carries a status, so a bulk set to "Contacted" must skip it (N6-21)
    // while a set to "Dead" moves it.
    const [lead] = await db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), eq(schema.leads.refId, refs.contacted)));
    await db.insert(schema.leadStatusHistory).values({ tenantId, leadId: lead.id, status: "Contacted", changedByUserId: userId });

    // The other tenant's lead: same shape, same state, so EVERY filter here matches it.
    otherRef = await mk(otherTenantId, otherUpload, {});
  }

  const leadRow = (tid: string, refId: string) =>
    db.select().from(schema.leads).where(and(eq(schema.leads.tenantId, tid), eq(schema.leads.refId, refId)));

  const countRows = async (table: typeof schema.auditLog | typeof schema.leadStatusHistory | typeof schema.leadTags) => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.tenantId, tenantId));
    return Number(row.n);
  };

  /** The whole tenant, as the selection bar's escalation would serialize it. */
  const ALL_FILTER = { mode: "filter" as const, filters: { statuses: [] as string[] } };

  beforeAll(() => {
    db = getDb();
    userId = randomUUID();
  });

  // These are WRITE tests: a shared board would make every number order-dependent.
  beforeEach(async () => {
    await seed();
    setRouteScope(scope);
  });

  afterAll(async () => {
    await cleanup();
    setRouteScope(null);
  });

  // ── N6-10..15: assign ───────────────────────────────────────────────────────

  it("N6-10/T-3: bulk assign is a full transfer that writes ONLY the manual overlay (PRN-05)", async () => {
    const [before] = await leadRow(tenantId, refs.routed);
    const { status, body } = await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: [refs.free, refs.routed, refs.atA, refs.removed] },
      partnerId: partnerB,
    });
    expect(status).toBe(200);
    // All three kept leads move — including the PIPELINE-ROUTED one and the one already
    // manually assigned elsewhere. That is the "full transfer" half of owner A1: eligibility
    // is "effective owner ≠ destination", not the legacy "still unmatched".
    expect(body.applied).toBe(3);
    expect(body.skipped).toEqual({ removedMls: 1 });
    expect(body.total).toBe(4);
    expect(body.skippedRefs).toEqual([{ ref: refs.removed, reason: "removedMls" }]);

    const [after] = await leadRow(tenantId, refs.routed);
    // The import snapshot is byte-identical — only the additive overlay moved (PRN-05).
    expect(after.partnerId).toBe(before.partnerId);
    expect(after.matchMethod).toBe(before.matchMethod);
    expect(after.matchedOn).toBe(before.matchedOn);
    expect(after.manualPartnerId).toBe(partnerB);
    expect(after.manualAssignedBy).toBe(userId);
  });

  it("N6-10: a lead whose effective owner is already the destination is skipped, not rewritten", async () => {
    const { body } = await post(assignPost, "/api/leads/bulk/assign", {
      // `routed` is pipeline-routed to A; `atA` carries A as its manual overlay. Both read as
      // "already at A" through `coalesce(manual_partner_id, partner_id)`.
      selection: { mode: "refs", leadRefs: [refs.free, refs.routed, refs.atA] },
      partnerId: partnerA,
    });
    expect(body.applied).toBe(1);
    expect(body.skipped).toEqual({ alreadyAssigned: 2 });
    const [routed] = await leadRow(tenantId, refs.routed);
    expect(routed.manualPartnerId).toBeNull(); // never given a redundant overlay
  });

  it("N6-13: one audit row per assigned lead, flagged bulk, with the server-resolved partner", async () => {
    await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: [refs.free, refs.routed] },
      partnerId: partnerB,
    });
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.action, "lead.manually_assigned")));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => (r.after as Record<string, unknown>).bulk === true)).toBe(true);
    expect(rows.every((r) => (r.after as Record<string, unknown>).partnerRefId === "JV-002")).toBe(true);
    expect(rows.map((r) => r.entityRef).sort()).toEqual([refs.free, refs.routed].sort());
  });

  it("N6-13: the audit `before` names the owner the lead moved AWAY from, not null", async () => {
    // pr-reviewer F-1. The unmatched-only precedents hardcoded `partnerId: null` because it
    // was true for them; on a TRANSFER a null would assert "this lead had no owner" about a
    // lead that plainly did — the trail would misreport the one fact it exists to record.
    await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: [refs.atA, refs.routed, refs.free] },
      partnerId: partnerB,
    });
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.action, "lead.manually_assigned")));
    const before = new Map(rows.map((r) => [r.entityRef, r.before as Record<string, unknown>]));
    expect(before.get(refs.atA)?.effectiveOwner).toBe(partnerA); // manual overlay was A
    expect(before.get(refs.routed)?.effectiveOwner).toBe(partnerA); // pipeline snapshot was A
    expect(before.get(refs.free)?.effectiveOwner).toBeNull(); // genuinely had no owner
    const after = new Map(rows.map((r) => [r.entityRef, r.after as Record<string, unknown>]));
    expect(after.get(refs.atA)).toMatchObject({ effectiveOwner: partnerB, partnerRefId: "JV-002", bulk: true });
  });

  it("N6-11: a revoked partner is never a valid destination, and nothing is written", async () => {
    const { status, body } = await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: [refs.free] },
      partnerId: revoked,
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: "invalid_target" });
    const [row] = await leadRow(tenantId, refs.free);
    expect(row.manualPartnerId).toBeNull();
  });

  it("N6-12: filter mode assigns the whole matching set without an id list crossing the wire", async () => {
    const { status, body } = await post(assignPost, "/api/leads/bulk/assign", {
      selection: ALL_FILTER,
      partnerId: partnerB,
    });
    expect(status).toBe(200);
    // Every kept lead in the tenant except the one already at B (none) — 4 kept, 1 removed.
    expect(body.applied).toBe(4);
    expect(body.skipped).toEqual({ removedMls: 1 });
    // TST-01d: the other tenant's lead matches this filter in every respect but tenancy.
    const [foreign] = await leadRow(otherTenantId, otherRef);
    expect(foreign.manualPartnerId).toBeNull();
  });

  it("N6-15: exactly one assigned lead notifies per-lead; a batch notifies once per run", async () => {
    const single = await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: [refs.free] },
      partnerId: partnerA,
    });
    expect(single.body.applied).toBe(1);
    const batch = await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: [refs.routed, refs.contacted] },
      partnerId: partnerB,
    });
    expect(batch.body.applied).toBe(2);
    // Partner B has no seats in this fixture, so the fan-out is a no-op — what this pins is
    // that the notify leg cannot throw the request (best-effort, outside the transaction).
    expect(batch.status).toBe(200);
  });

  // ── N6-20..23: status ───────────────────────────────────────────────────────

  it("N6-21: bulk status skips leads already at the target and refuses removed-MLS leads", async () => {
    const { status, body } = await post(statusPost, "/api/leads/bulk/status", {
      selection: { mode: "refs", leadRefs: [refs.free, refs.contacted, refs.removed] },
      status: "Contacted",
    });
    expect(status).toBe(200);
    expect(body.applied).toBe(1); // only `free` (currently the default "New")
    expect(body.skipped).toEqual({ alreadyAtStatus: 1, removedMls: 1 });
    const [removedLead] = await leadRow(tenantId, refs.removed);
    const history = await db
      .select()
      .from(schema.leadStatusHistory)
      .where(and(eq(schema.leadStatusHistory.tenantId, tenantId), eq(schema.leadStatusHistory.leadId, removedLead.id)));
    expect(history.length).toBe(0);
  });

  it("N6-22/T-4: a re-run at the same target writes ZERO new history rows and reports the skip", async () => {
    const first = await post(statusPost, "/api/leads/bulk/status", { selection: ALL_FILTER, status: "Dead" });
    expect(first.body.applied).toBe(4);
    const after = await countRows(schema.leadStatusHistory);
    const second = await post(statusPost, "/api/leads/bulk/status", { selection: ALL_FILTER, status: "Dead" });
    expect(second.body.applied).toBe(0);
    expect(second.body.skipped).toEqual({ alreadyAtStatus: 4, removedMls: 1 });
    expect(await countRows(schema.leadStatusHistory)).toBe(after);
  });

  it("N6-22/T-3: bulk status never touches the assignment columns", async () => {
    const [before] = await leadRow(tenantId, refs.routed);
    await post(statusPost, "/api/leads/bulk/status", { selection: ALL_FILTER, status: "Closed" });
    const [after] = await leadRow(tenantId, refs.routed);
    expect(after.partnerId).toBe(before.partnerId);
    expect(after.manualPartnerId).toBe(before.manualPartnerId);
    expect(after.matchMethod).toBe(before.matchMethod);
    // TST-01d again, on the other write path.
    const [foreignLead] = await leadRow(otherTenantId, otherRef);
    const foreignHistory = await db
      .select()
      .from(schema.leadStatusHistory)
      .where(eq(schema.leadStatusHistory.leadId, foreignLead.id));
    expect(foreignHistory.length).toBe(0);
  });

  // ── N6-30..33: tags ─────────────────────────────────────────────────────────

  it("N6-31/T-4: bulk tag add is idempotent and taggable at any MLS status", async () => {
    const first = await post(tagsPost, "/api/leads/bulk/tags", { selection: ALL_FILTER, op: "add", tagId: tagX });
    expect(first.status).toBe(200);
    expect(first.body.applied).toBe(5); // the removed lead is taggable too
    expect(first.body.skipped).toEqual({});
    const second = await post(tagsPost, "/api/leads/bulk/tags", { selection: ALL_FILTER, op: "add", tagId: tagX });
    expect(second.body.applied).toBe(0);
    expect(second.body.skipped).toEqual({ alreadyTagged: 5 });
    expect(await countRows(schema.leadTags)).toBe(5);
  });

  it("N6-31: remove reports the leads that never carried the tag", async () => {
    await post(tagsPost, "/api/leads/bulk/tags", { selection: { mode: "refs", leadRefs: [refs.free] }, op: "add", tagId: tagX });
    const { body } = await post(tagsPost, "/api/leads/bulk/tags", {
      selection: { mode: "refs", leadRefs: [refs.free, refs.routed] },
      op: "remove",
      tagId: tagX,
    });
    expect(body.applied).toBe(1);
    expect(body.skipped).toEqual({ notTagged: 1 });
    expect(body.skippedRefs).toEqual([{ ref: refs.routed, reason: "notTagged" }]);
    expect(await countRows(schema.leadTags)).toBe(0);
  });

  it("N6-31: a tag op FILTERED by tag composes two sibling lead_tags subqueries in one statement", async () => {
    // audit-tenancy F-2: `carries` (the tagged/not-tagged verdict) and `taggedWithAny` (the
    // `?tags=` filter predicate) are BOTH unaliased `lead_tags` EXISTS subqueries, and this is
    // the only shape that puts them in the same statement. They are siblings, each with its
    // own scope, so neither shadows the other — but that is a claim about how Postgres
    // resolves the names, so it gets pinned against a live database rather than reasoned about.
    await post(tagsPost, "/api/leads/bulk/tags", {
      selection: { mode: "refs", leadRefs: [refs.free, refs.routed] },
      op: "add",
      tagId: tagX,
    });
    const { status, body } = await post(tagsPost, "/api/leads/bulk/tags", {
      selection: { mode: "filter", filters: { tags: [tagX], statuses: [] } },
      op: "remove",
      tagId: tagX,
    });
    expect(status).toBe(200);
    expect(body.total).toBe(2); // exactly the two leads the tag filter matched
    expect(body.applied).toBe(2);
    expect(await countRows(schema.leadTags)).toBe(0);
  });

  it("N6-32: a bulk tag run writes ONE summary audit row, not one per lead", async () => {
    await post(tagsPost, "/api/leads/bulk/tags", { selection: ALL_FILTER, op: "add", tagId: tagX });
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.action, "lead.tags_bulk")));
    expect(rows.length).toBe(1);
    expect(rows[0].after).toMatchObject({ op: "add", tagId: tagX, count: 5 });
  });

  it("N6-30/T-1: a tag from another tenant does not resolve, and nothing is written", async () => {
    const { status, body } = await post(tagsPost, "/api/leads/bulk/tags", {
      selection: ALL_FILTER,
      op: "add",
      tagId: otherTagId,
    });
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "not_found" });
    expect(await countRows(schema.leadTags)).toBe(0);
  });

  // ── N6-01..06: the shared contract ──────────────────────────────────────────

  it("T-1: a ref from another tenant is reported as notFound and its row is never touched", async () => {
    const { body } = await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: [refs.free, otherRef, "LD-26-99999"] },
      partnerId: partnerA,
    });
    expect(body.applied).toBe(1);
    expect(body.skipped).toEqual({ notFound: 2 });
    expect((body.skippedRefs ?? []).map((s) => s.ref).sort()).toEqual([otherRef, "LD-26-99999"].sort());
    expect((body.skippedRefs ?? []).every((s) => s.reason === "notFound")).toBe(true);
    const [foreign] = await leadRow(otherTenantId, otherRef);
    expect(foreign.manualPartnerId).toBeNull();
  });

  it("T-1: a FILTER naming another tenant's tag or partner matches nothing — 200 with total 0, never an error", async () => {
    // audit-tenancy F-3. Two things are being pinned at once. (1) The filter arm resolves
    // through the same tenant-scoped predicate as the list, so a foreign id simply matches no
    // rows. (2) It must not 404/400: a distinct error for "that id exists somewhere" would be
    // an existence oracle across tenants. "Valid request, empty result" is the only safe answer.
    const before = await countRows(schema.leadStatusHistory);
    for (const filters of [{ tags: [otherTagId], statuses: [] }, { partnerId: otherPartnerId, statuses: [] }]) {
      const { status, body } = await post(statusPost, "/api/leads/bulk/status", {
        selection: { mode: "filter", filters },
        status: "Dead",
      });
      expect(status, JSON.stringify(filters)).toBe(200);
      expect(body.total, JSON.stringify(filters)).toBe(0);
      expect(body.applied, JSON.stringify(filters)).toBe(0);
      expect(body.skipped).toEqual({});
    }
    expect(await countRows(schema.leadStatusHistory)).toBe(before);
  });

  it("T-1: an escalated tag add never reaches another tenant's lead row", async () => {
    // audit-tenancy F-3: the `countRows` legs elsewhere are tenant-FILTERED, so they can only
    // prove arithmetic. This one addresses the foreign lead DIRECTLY — the only shape of
    // assertion that can catch a junction row written across the boundary.
    await post(tagsPost, "/api/leads/bulk/tags", { selection: ALL_FILTER, op: "add", tagId: tagX });
    const [foreign] = await leadRow(otherTenantId, otherRef);
    const junction = await db.select().from(schema.leadTags).where(eq(schema.leadTags.leadId, foreign.id));
    expect(junction).toEqual([]);
  });

  it("N6-05/T-5: dryRun writes nothing — no rows, no audit — and its split equals the execute's", async () => {
    const before = {
      audit: await countRows(schema.auditLog),
      history: await countRows(schema.leadStatusHistory),
      tags: await countRows(schema.leadTags),
    };
    const body = { selection: ALL_FILTER, status: "Contacted" };
    const dry = await post(statusPost, "/api/leads/bulk/status", { ...body, dryRun: true });
    expect(dry.body.applied).toBeUndefined();
    expect(dry.body.eligible).toBe(3); // `contacted` is already there; `removed` is refused
    expect(dry.body.skipped).toEqual({ removedMls: 1, alreadyAtStatus: 1 });
    expect(await countRows(schema.auditLog)).toBe(before.audit);
    expect(await countRows(schema.leadStatusHistory)).toBe(before.history);

    const run = await post(statusPost, "/api/leads/bulk/status", body);
    expect(run.body.applied).toBe(dry.body.eligible);
    expect(run.body.skipped).toEqual(dry.body.skipped);
    expect(run.body.total).toBe(dry.body.total);

    // The same purity leg on the two other endpoints.
    const dryAssign = await post(assignPost, "/api/leads/bulk/assign", { selection: ALL_FILTER, partnerId: partnerA, dryRun: true });
    // `routed` and `atA` both read as already-at-A; `removed` is refused.
    expect(dryAssign.body.eligible).toBe(2);
    const dryTags = await post(tagsPost, "/api/leads/bulk/tags", { selection: ALL_FILTER, op: "add", tagId: tagX, dryRun: true });
    expect(dryTags.body.eligible).toBe(5);
    expect(await countRows(schema.leadTags)).toBe(before.tags);
    const [untouched] = await leadRow(tenantId, refs.free);
    expect(untouched.manualPartnerId).toBeNull();
  });

  it("N6-02/T-6: a malformed filter is a 400 invalid_filters with zero writes — never a degraded filter", async () => {
    const before = await countRows(schema.leadStatusHistory);
    for (const filters of [
      { statuses: ["Nope"] }, // not in the vocabulary
      { state: "Arizona" }, // the list would degrade this to no filter
      { hot: "1" }, // the list accepts the string; a write does not
      { dateFrom: "2026-02-31" }, // shape-valid, not a real date
      { tags: ["not-a-uuid"] },
      { page: 2 }, // not a filter at all — strictObject rejects it
    ]) {
      const { status, body } = await post(statusPost, "/api/leads/bulk/status", {
        selection: { mode: "filter", filters },
        status: "Dead",
      });
      expect(status, JSON.stringify(filters)).toBe(400);
      expect(body, JSON.stringify(filters)).toMatchObject({ code: "invalid_filters" });
    }
    expect(await countRows(schema.leadStatusHistory)).toBe(before);
  });

  it("N6-05: an explicit `dryRun: false` executes — the flag is a boolean, not a tripwire", async () => {
    // audit-tenancy F-6: `z.literal(true)` would 400 here, turning the obvious way to say
    // "actually run it" into a client error on the SAFE side of the flag.
    const { status, body } = await post(statusPost, "/api/leads/bulk/status", {
      selection: { mode: "refs", leadRefs: [refs.free] },
      status: "Contacted",
      dryRun: false,
    });
    expect(status).toBe(200);
    expect(body.applied).toBe(1);
  });

  it("N6-01: the refs arm is bounded at 200 and rejects a malformed ref", async () => {
    const tooMany = await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: Array.from({ length: 201 }, (_, i) => `LD-26-9${String(i).padStart(4, "0")}`) },
      partnerId: partnerA,
    });
    expect(tooMany.status).toBe(400);
    const malformed = await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: ["nope"] },
      partnerId: partnerA,
    });
    expect(malformed.status).toBe(400);
  });

  it("N6-06: a duplicated ref is counted once, so the reported split still adds up", async () => {
    const { body } = await post(assignPost, "/api/leads/bulk/assign", {
      selection: { mode: "refs", leadRefs: [refs.free, refs.free, refs.atA] },
      partnerId: partnerA,
    });
    expect(body.total).toBe(2);
    expect(body.applied).toBe(1);
    expect(body.skipped).toEqual({ alreadyAssigned: 1 });
  });
});
