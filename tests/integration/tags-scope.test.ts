import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { tagWhere, leadTagWhere, listTags, attachTag, TagNotFoundError, LeadNotFoundError } from "@/modules/tags/tags";
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
