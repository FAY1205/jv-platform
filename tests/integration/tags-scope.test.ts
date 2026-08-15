import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import {
  tagWhere, leadTagWhere, listTags, listLeadTags, tagsByLeadRef, createTag, updateTag, deleteTag,
  attachTag, detachTag, TagNotFoundError, LeadNotFoundError, TagScopeError,
} from "@/modules/tags/tags";
import { listLeads } from "@/modules/leads/queries";
import { LeadsQuerySchema } from "@/modules/leads/schema";
import { purgeAuditLog } from "../helpers/audit";

// WP-TAG-1 / TAG-02 (live): the tags isolation matrix (TST-01 shape). Cross-tenant tags are
// invisible AND unattachable in BOTH directions (in-tenant lead + foreign tag, foreign lead +
// in-tenant tag), and the RLS backstop's two halves are asserted via pg_policies — the
// 0041/tasks-scope precedent. Self-skips without DATABASE_URL.
// Run with node --env-file=.env.local.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-tags-iso";
const SLUG_B = "test-tags-iso-b";

suite("TAG-02: tag isolation + the RLS backstop", () => {
  let db: ReturnType<typeof getDb>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG, SLUG_B]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadTags).where(inArray(schema.leadTags.tenantId, tids));
    await db.delete(schema.tags).where(inArray(schema.tags.tenantId, tids));
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();

    const [t] = await db.insert(schema.tenants).values({ name: "Tags Iso", slug: SLUG }).returning({ id: schema.tenants.id });
    const [tb] = await db.insert(schema.tenants).values({ name: "Tags Iso B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    id.tenantB = tb.id;

    id.adminUser = randomUUID();
    id.adminUserB = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@tags.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.adminUserB, tenantId: tb.id, email: "admin@tags-b.test", role: "admin" });
    // A partner org in tenant A, purely so a real partner ScopeContext exists for the
    // module-level admin-gate probe (tags have no partner surface by design).
    const [pa] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "JV-201", name: "PA", color: "#111", status: "active" })
      .returning({ id: schema.partners.id });
    id.partner = pa.id;
    id.partnerUser = randomUUID();
    await db.insert(schema.users).values({ id: id.partnerUser, tenantId: t.id, email: "px@tags.test", role: "partner", partnerId: pa.id });

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-201", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [upB] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "IM-26-202", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [leadA] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-20001", uploadId: up.id, dedupeKey: "ta|1", rawJson: {}, matchMethod: "none", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    const [leadB] = await db
      .insert(schema.leads)
      .values({ tenantId: tb.id, refId: "LD-26-20002", uploadId: upB.id, dedupeKey: "tb|1", rawJson: {}, matchMethod: "none", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    id.leadA = leadA.id;
    id.leadB = leadB.id;

    const [tagA] = await db.insert(schema.tags).values({ tenantId: t.id, name: "A-Probate", color: "teal" }).returning({ id: schema.tags.id });
    const [tagB] = await db.insert(schema.tags).values({ tenantId: tb.id, name: "B-Probate", color: "blue" }).returning({ id: schema.tags.id });
    id.tagA = tagA.id;
    id.tagB = tagB.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  const adminA = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminUser });
  const adminB = (): ScopeContext => ({ tenantId: id.tenantB, role: "admin", userId: id.adminUserB });

  it("TAG-02/SCP-01: a tenant never sees another tenant's tags", async () => {
    const namesA = (await db.select({ name: schema.tags.name }).from(schema.tags).where(tagWhere(adminA()))).map((r) => r.name);
    expect(namesA).toContain("A-Probate");
    expect(namesA).not.toContain("B-Probate");

    const namesB = (await db.select({ name: schema.tags.name }).from(schema.tags).where(tagWhere(adminB()))).map((r) => r.name);
    expect(namesB).toContain("B-Probate");
    expect(namesB).not.toContain("A-Probate");
  });

  it("TAG-02/SCP-01: an IN-TENANT lead + a FOREIGN tag is refused", async () => {
    await expect(attachTag(adminA(), "LD-26-20001", id.tagB)).rejects.toBeInstanceOf(TagNotFoundError);
    const rows = await db.select({ id: schema.leadTags.id }).from(schema.leadTags).where(leadTagWhere(adminA()));
    expect(rows).toHaveLength(0); // the failed attach left nothing behind
  });

  it("TAG-02/SCP-01: a FOREIGN lead + an IN-TENANT tag is refused", async () => {
    // The lead resolves through leadWhere, so tenant A cannot even name tenant B's lead.
    await expect(attachTag(adminA(), "LD-26-20002", id.tagA)).rejects.toBeInstanceOf(LeadNotFoundError);
    const rows = await db.select({ id: schema.leadTags.id }).from(schema.leadTags).where(leadTagWhere(adminA()));
    expect(rows).toHaveLength(0);
  });

  it("TAG-02/SCP-01: attachments never cross the tenant boundary, and usage counts don't either", async () => {
    await attachTag(adminA(), "LD-26-20001", id.tagA);
    // Tenant B writes its own attachment on its own lead + tag.
    await db.insert(schema.leadTags).values({
      tenantId: id.tenantB,
      leadId: id.leadB,
      tagId: id.tagB,
      addedByUserId: id.adminUserB,
    });

    const aRows = await db.select({ tagId: schema.leadTags.tagId }).from(schema.leadTags).where(leadTagWhere(adminA()));
    expect(aRows.map((r) => r.tagId)).toEqual([id.tagA]);

    // TAG-06: the manager's counts are per tenant — B's attachment must not inflate A's.
    const aTags = await listTags(adminA());
    expect(aTags).toHaveLength(1);
    expect(aTags[0]).toMatchObject({ name: "A-Probate", leadCount: 1 });
    const bTags = await listTags(adminB());
    expect(bTags).toHaveLength(1);
    expect(bTags[0]).toMatchObject({ name: "B-Probate", leadCount: 1 });
  });

  // ── the isolation legs a randomUUID probe cannot reach (audit-tenancy F-3) ─────────
  // A non-existent id proves an id is REJECTED; it cannot tell "rejected because it is
  // another tenant's" from "rejected because it is nobody's". Every leg below uses a REAL
  // row belonging to the other tenant, which is the only oracle for the tenant column.

  it("TAG-01/SCP-01: the unique name index is PER TENANT — B's name is free in A (non-oracle)", async () => {
    // The leg that guards the index's tenant_id column: without it this would 409 instead of
    // creating, and every tenant would silently share one namespace.
    const made = await createTag(adminA(), { name: "B-Probate", color: "gold" });
    expect(made.id).toBeTruthy();
    expect((await listTags(adminA())).map((t) => t.name).sort()).toEqual(["A-Probate", "B-Probate"]);
    // …and B still has exactly its own one row (the create landed in A, not B).
    expect(await listTags(adminB())).toHaveLength(1);
    await deleteTag(adminA(), made.id); // restore the single-tag baseline for later legs
  });

  it("TAG-02/SCP-01: every WRITE against a REAL foreign tag is refused", async () => {
    // rename / recolor / delete / detach — the four mutations that take a tag id directly.
    await expect(updateTag(adminA(), id.tagB, { name: "stolen" })).rejects.toBeInstanceOf(TagNotFoundError);
    await expect(updateTag(adminA(), id.tagB, { color: "rose" })).rejects.toBeInstanceOf(TagNotFoundError);
    await expect(deleteTag(adminA(), id.tagB)).rejects.toBeInstanceOf(TagNotFoundError);
    await expect(detachTag(adminA(), "LD-26-20001", id.tagB)).rejects.toBeInstanceOf(TagNotFoundError);
    // B's tag is untouched by any of it.
    const [row] = await db.select({ name: schema.tags.name, color: schema.tags.color }).from(schema.tags).where(eq(schema.tags.id, id.tagB));
    expect(row).toEqual({ name: "B-Probate", color: "blue" });
  });

  it("TAG-02/SCP-01: detach is refused ACROSS the boundary in both directions", async () => {
    // foreign tag + in-tenant lead (above) and in-tenant tag + foreign lead (here).
    await expect(detachTag(adminA(), "LD-26-20002", id.tagA)).rejects.toBeInstanceOf(LeadNotFoundError);
    await expect(detachTag(adminB(), "LD-26-20001", id.tagB)).rejects.toBeInstanceOf(LeadNotFoundError);
    // B's own attachment (written directly in the previous test) survived both attempts.
    expect(await db.select({ id: schema.leadTags.id }).from(schema.leadTags).where(leadTagWhere(adminB()))).toHaveLength(1);
  });

  it("TAG-02/SCP-01: a foreign lead ref is refused by the per-lead reads too", async () => {
    await expect(listLeadTags(adminA(), "LD-26-20002")).rejects.toBeInstanceOf(LeadNotFoundError);
    // The batch loader takes refs FROM A CALLER, so it is probed with a MIXED array: only the
    // in-tenant ref comes back keyed, the foreign one is simply absent (not an error, since a
    // page's refs are already scope-derived — but never resolved either).
    const byRef = await tagsByLeadRef(db, adminA(), ["LD-26-20001", "LD-26-20002"]);
    expect([...byRef.keys()]).toEqual(["LD-26-20001"]);
  });

  it("TAG-02/audit-tenancy F-2: tagsByLeadRef refuses a PARTNER scope in the module itself", async () => {
    // Its callers include listLeads, which is not a tags route — so the admin gate cannot be
    // the routes' job alone (the listLeadsBoard precedent).
    const partner: ScopeContext = { tenantId: id.tenant, role: "partner", userId: id.partnerUser, partnerId: id.partner };
    await expect(tagsByLeadRef(db, partner, ["LD-26-20001"])).rejects.toBeInstanceOf(TagScopeError);
  });

  it("TAG-03/SCP-01: the ?tags= filter with a REAL foreign tag id returns nothing and changes nothing", async () => {
    // The leg that guards taggedWithAny's tenant predicate: B's tag IS attached to B's lead,
    // so a dropped tenant filter would surface a cross-tenant row rather than an empty set.
    const foreign = await listLeads(adminA(), LeadsQuerySchema.parse({ tags: id.tagB }));
    expect(foreign.leads).toHaveLength(0);
    expect(foreign.total).toBe(0);
    // …and A's own filter still works, i.e. the predicate wasn't just broken outright.
    const own = await listLeads(adminA(), LeadsQuerySchema.parse({ tags: id.tagA }));
    expect(own.leads.map((l) => l.refId)).toEqual(["LD-26-20001"]);
    // A mixed list is still any-of over the caller's OWN tags only.
    const mixed = await listLeads(adminA(), LeadsQuerySchema.parse({ tags: `${id.tagA},${id.tagB}` }));
    expect(mixed.leads.map((l) => l.refId)).toEqual(["LD-26-20001"]);
    expect(mixed.total).toBe(1);
  });

  it("TAG-06/ADR-0013: a MIS-TENANTED junction row cannot inflate a usage count", async () => {
    // Pins the deliberate defence-in-depth: listTags' leadTags join carries its OWN tenant
    // predicate, so a row whose tenant_id disagrees with its lead/tag is invisible to both
    // tenants rather than counted by the one that owns the tag. Written raw — no app path
    // produces this, which is exactly why the guard is worth pinning. A FRESH tag, so the
    // count under test starts at a known zero (leadA already carries tagA legitimately).
    const orphanTag = await createTag(adminA(), { name: "A-Orphan", color: "rose" });
    await db.insert(schema.leadTags).values({
      tenantId: id.tenantB, // ← the lie: B's tenant on A's lead + A's tag
      leadId: id.leadA,
      tagId: orphanTag.id,
      addedByUserId: id.adminUserB,
    });
    try {
      // Invisible to the tag's OWN tenant (the join's tenant predicate rejects it)…
      expect((await listTags(adminA())).find((t) => t.id === orphanTag.id)?.leadCount).toBe(0);
      // …and to the tenant it falsely claims (which cannot see the tag at all).
      expect((await listTags(adminB())).map((t) => t.id)).toEqual([id.tagB]);
      expect((await listTags(adminB())).find((t) => t.id === id.tagB)?.leadCount).toBe(1); // unchanged
    } finally {
      await db.delete(schema.leadTags).where(eq(schema.leadTags.tagId, orphanTag.id));
      await db.delete(schema.tags).where(and(tagWhere(adminA()), eq(schema.tags.id, orphanTag.id)));
    }
  });

  it("TAG-02/SEC-01: BOTH tags_scope policy halves pin tenant AND the admin role", async () => {
    const rows = await db.execute<{ qual: string; with_check: string }>(sql`
      select qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'tags' and policyname = 'tags_scope'
    `);
    expect(rows.length, "tags_scope policy exists").toBe(1);
    // Counted, not substring-matched, so a dropped predicate fails this (audit-tenancy F-8).
    expect((rows[0].qual.match(/app_current_tenant\(\)/g) ?? []).length).toBe(1);
    expect(rows[0].qual).toContain("app_current_role");
    expect((rows[0].with_check.match(/app_current_tenant\(\)/g) ?? []).length).toBe(1);
    expect(rows[0].with_check).toContain("app_current_role");
  });

  it("TAG-02/SEC-01: lead_tags_scope's WITH CHECK pins writer identity AND both in-tenant refs", async () => {
    const rows = await db.execute<{ qual: string; with_check: string }>(sql`
      select qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'lead_tags' and policyname = 'lead_tags_scope'
    `);
    expect(rows.length, "lead_tags_scope policy exists").toBe(1);
    const qual = rows[0].qual;
    const wc = rows[0].with_check;

    expect((qual.match(/app_current_tenant\(\)/g) ?? []).length).toBe(1);
    expect(qual).toContain("app_current_role");

    // A tenant-only WITH CHECK is NOT a backstop (audit-tenancy F-1): writes pin the writer,
    // an in-tenant lead, and an in-tenant tag.
    expect(wc).toContain("app_current_user");
    expect(wc).toContain("added_by_user_id");
    expect(wc).toContain("lead_id");
    expect(wc).toContain("tag_id");
    // Row + the lead subquery + the tag subquery.
    expect((wc.match(/app_current_tenant\(\)/g) ?? []).length).toBe(3);
  });

  it("TAG-01/SEC-01: RLS is enabled on both tables", async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select relname, relrowsecurity from pg_class where relname in ('tags', 'lead_tags')
    `);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.relrowsecurity, `${r.relname} RLS`).toBe(true);
  });

  it("TAG-01/DM-11: the case-insensitive name index and the FK-covering indexes exist", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes where tablename in ('tags', 'lead_tags')
    `);
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get("tags_tenant_name_idx")).toMatch(/UNIQUE.*lower\(name\)/i);
    expect(byName.has("tags_tenant_idx")).toBe(true);
    expect(byName.get("lead_tags_lead_tag_idx")).toMatch(/UNIQUE/i);
    // Every FK gets a leading-column index (db-linter 0001 precedent).
    expect(byName.has("lead_tags_tenant_idx")).toBe(true);
    expect(byName.has("lead_tags_tag_idx")).toBe(true);
    expect(byName.has("lead_tags_added_by_idx")).toBe(true);
  });
});
