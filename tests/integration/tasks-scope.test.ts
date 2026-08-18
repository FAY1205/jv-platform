import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { taskWhere } from "@/lib/scope";

// WP-TSK-1 / TSK-09 (live): lead_tasks isolation matrix — cross-tenant, cross-partner,
// cross-stream (admin↔partner), and post-re-route invisibility (ADR-0044). Exercises
// taskWhere directly (module functions land in WP-TSK-2) + asserts the RLS backstop
// predicate via pg_policies (isolation.test.ts precedent). Self-skips without
// DATABASE_URL. Run with node --env-file=.env.local.
//
// SCOPE NOTE (audit-tenancy T-2): this file covers ROW visibility only. C-11 added a second
// isolation axis — which USER IDENTITY a visible row may resolve (the assignee/author joins
// in modules/tasks/tasks.ts, guarded by sameStreamUsers). Those legs live in
// tests/integration/tasks-api.test.ts ("C-11/R-65", "C-11/PRN-13") because they need the
// module's read path, not taskWhere alone. A change to sameStreamUsers must run BOTH files.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-tasks-iso";
const SLUG_B = "test-tasks-iso-b";

// C-8 / WP-TSK-2a: taskWhere's partner arm now carries the distribution hold, so partner-owned
// leads whose tasks a partner must SEE are seeded past the hold window (else they read as held).
const RELEASED_AT = new Date(Date.now() - 10 * 60 * 1000);

suite("TSK-09/ADR-0044: two-stream lead-task visibility", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG, SLUG_B]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadTasks).where(inArray(schema.leadTasks.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();

    const [t] = await db.insert(schema.tenants).values({ name: "Tasks Iso", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [tb] = await db.insert(schema.tenants).values({ name: "Tasks Iso B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantB = tb.id;

    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.py = py.id;

    id.adminUser = randomUUID();
    id.pxUser = randomUUID();
    id.pyUser = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@tasks.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@tasks.test", role: "partner", partnerId: px.id });
    await db.insert(schema.users).values({ id: id.pyUser, tenantId: t.id, email: "py@tasks.test", role: "partner", partnerId: py.id });

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-101", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [leadX] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-10001", uploadId: up.id, dedupeKey: "x|1", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept", createdAt: RELEASED_AT })
      .returning({ id: schema.leads.id });
    const [leadY] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-10002", uploadId: up.id, dedupeKey: "y|2", rawJson: {}, partnerId: py.id, matchMethod: "zip", mlsStatus: "kept", createdAt: RELEASED_AT })
      .returning({ id: schema.leads.id });
    id.leadX = leadX.id;
    id.leadY = leadY.id;

    // Tenant B: one admin user + one lead + one admin task, for the cross-tenant probe.
    id.adminUserB = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUserB, tenantId: tb.id, email: "admin@tasks-b.test", role: "admin" });
    const [upB] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "IM-26-102", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [leadB] = await db
      .insert(schema.leads)
      .values({ tenantId: tb.id, refId: "LD-26-10003", uploadId: upB.id, dedupeKey: "z|3", rawJson: {}, matchMethod: "none", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    id.leadB = leadB.id;

    // Tenant B also gets a PARTNER org + owned lead, so the partner arm of taskWhere (the
    // one carrying the two subqueries) is exercised across the tenant boundary (audit F-4).
    const [pb] = await db.insert(schema.partners).values({ tenantId: tb.id, refId: "JV-001", name: "PB", color: "#333", status: "active" }).returning({ id: schema.partners.id });
    id.pb = pb.id;
    id.pbUser = randomUUID();
    await db.insert(schema.users).values({ id: id.pbUser, tenantId: tb.id, email: "pb@tasks-b.test", role: "partner", partnerId: pb.id });
    const [leadB2] = await db
      .insert(schema.leads)
      .values({ tenantId: tb.id, refId: "LD-26-10004", uploadId: upB.id, dedupeKey: "w|4", rawJson: {}, partnerId: pb.id, matchMethod: "zip", mlsStatus: "kept", createdAt: RELEASED_AT })
      .returning({ id: schema.leads.id });
    id.leadB2 = leadB2.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const admin = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.adminUser });
  const partnerX = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });
  const partnerY = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pyUser, partnerId: id.py });

  const readTitles = async (scope: ScopeContext) =>
    (await db.select({ title: schema.leadTasks.title }).from(schema.leadTasks).where(taskWhere(scope, db))).map((r) => r.title);

  it("TSK-01: a task round-trips its shape (title, due_on date, open done_at)", async () => {
    await db.insert(schema.leadTasks).values({
      tenantId: id.tenant,
      leadId: id.leadX,
      authorUserId: id.adminUser,
      authorRole: "admin",
      title: "ADMIN task on X",
      dueOn: "2026-08-20",
    });
    const [row] = await db
      .select()
      .from(schema.leadTasks)
      .where(eq(schema.leadTasks.title, "ADMIN task on X"));
    expect(row.dueOn).toBe("2026-08-20");
    expect(row.doneAt).toBeNull(); // null = open (TSK-01)
    expect(row.remindedAt).toBeNull();
    expect(row.assignedToUserId).toBeNull(); // null = creator's own (TSK-03)
  });

  it("TSK-09/PRN-13: admin tasks and partner tasks are mutually invisible", async () => {
    await db.insert(schema.leadTasks).values({
      tenantId: id.tenant,
      leadId: id.leadX,
      authorUserId: id.pxUser,
      authorRole: "partner",
      title: "X-PARTNER task on X",
    });

    const adminTitles = await readTitles(admin());
    expect(adminTitles).toContain("ADMIN task on X");
    expect(adminTitles).not.toContain("X-PARTNER task on X");

    const xTitles = await readTitles(partnerX());
    expect(xTitles).toContain("X-PARTNER task on X");
    expect(xTitles).not.toContain("ADMIN task on X");
  });

  it("TSK-09: partner A cannot read partner B's tasks", async () => {
    await db.insert(schema.leadTasks).values({
      tenantId: id.tenant,
      leadId: id.leadY,
      authorUserId: id.pyUser,
      authorRole: "partner",
      title: "Y-PARTNER task on Y",
    });
    const xTitles = await readTitles(partnerX());
    expect(xTitles).not.toContain("Y-PARTNER task on Y");
    const yTitles = await readTitles(partnerY());
    expect(yTitles).toContain("Y-PARTNER task on Y");
    expect(yTitles).not.toContain("X-PARTNER task on X");
  });

  it("TSK-09/ADR-0044: re-route X→Y hides X's tasks from both; revert restores only X's own", async () => {
    // Admin re-routes lead X to partner Y (the manual overlay moves the effective owner,
    // same ownership change editLead's "set" performs).
    await db.update(schema.leads).set({ manualPartnerId: id.py }).where(eq(schema.leads.id, id.leadX));

    // The new owner (Y) never sees the prior org's tasks (own-org author predicate)…
    expect(await readTitles(partnerY())).not.toContain("X-PARTNER task on X");
    // …and the prior owner (X) lost the lead, so their task drops out of their own view too.
    expect(await readTitles(partnerX())).not.toContain("X-PARTNER task on X");

    // The interim owner (Y) works the lead and authors their own task on it.
    await db.insert(schema.leadTasks).values({
      tenantId: id.tenant,
      leadId: id.leadX,
      authorUserId: id.pyUser,
      authorRole: "partner",
      title: "Y-INTERIM task on X",
    });
    expect(await readTitles(partnerY())).toContain("Y-INTERIM task on X");

    // REVERT leg (audit-tenancy F-4 — the leg a naive "ownership follows the lead"
    // regression would break): admin reverts the overlay.
    await db.update(schema.leads).set({ manualPartnerId: null }).where(eq(schema.leads.id, id.leadX));

    const xAfter = await readTitles(partnerX());
    expect(xAfter).toContain("X-PARTNER task on X"); // X's own task is restored…
    expect(xAfter).not.toContain("Y-INTERIM task on X"); // …but the interim org's never appears
    const yAfter = await readTitles(partnerY());
    expect(yAfter).not.toContain("X-PARTNER task on X");
    expect(yAfter).not.toContain("Y-INTERIM task on X"); // Y lost the lead — and their task's visibility with it
  });

  it("TSK-09/DM-09b: a recalled (soft-deleted) lead's tasks drop out of partner reads — admin stream unaffected", async () => {
    await db.update(schema.leads).set({ deletedAt: new Date() }).where(eq(schema.leads.id, id.leadX));
    const xTitles = await readTitles(partnerX());
    expect(xTitles).not.toContain("X-PARTNER task on X");
    // Intended asymmetry (audit F-4): the admin arm has no deleted_at filter — the operator
    // keeps their own work items on a recalled lead.
    expect(await readTitles(admin())).toContain("ADMIN task on X");
    await db.update(schema.leads).set({ deletedAt: null }).where(eq(schema.leads.id, id.leadX));
  });

  it("TSK-09/SCP-01: tasks never cross the tenant boundary", async () => {
    await db.insert(schema.leadTasks).values({
      tenantId: id.tenantB,
      leadId: id.leadB,
      authorUserId: id.adminUserB,
      authorRole: "admin",
      title: "TENANT-B admin task",
    });
    const adminTitles = await readTitles(admin());
    expect(adminTitles).not.toContain("TENANT-B admin task");
    const bScope: ScopeContext = { tenantId: id.tenantB, role: "admin", userId: id.adminUserB };
    expect(await readTitles(bScope)).toContain("TENANT-B admin task");
  });

  it("TSK-09/SCP-01: a PARTNER scope cannot read across tenants (subquery arm exercised)", async () => {
    // The case that would catch a dropped tenant filter inside ownLeads/ownAuthors (audit F-4).
    await db.insert(schema.leadTasks).values({
      tenantId: id.tenantB,
      leadId: id.leadB2,
      authorUserId: id.pbUser,
      authorRole: "partner",
      title: "TENANT-B partner task",
    });
    expect(await readTitles(partnerX())).not.toContain("TENANT-B partner task");
    const pbScope: ScopeContext = { tenantId: id.tenantB, role: "partner", userId: id.pbUser, partnerId: id.pb };
    expect(await readTitles(pbScope)).toContain("TENANT-B partner task");
  });

  it("TSK-09/SEC-01: BOTH RLS policy halves carry the full app predicate (qual AND with_check)", async () => {
    const rows = await db.execute<{ qual: string; with_check: string }>(sql`
      select qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'lead_tasks' and policyname = 'lead_tasks_scope'
    `);
    expect(rows.length, "lead_tasks_scope policy exists").toBe(1);
    const qual = rows[0].qual;
    const wc = rows[0].with_check;

    // READ half: two-stream + effective-owner + own-org author + recall filter.
    expect(qual).toContain("author_role");
    expect(qual).toMatch(/COALESCE\(.*manual_partner_id.*partner_id.*\)/i);
    expect(qual).toContain("author_user_id");
    expect(qual).toContain("deleted_at");
    // Tenant filter at the row AND inside both subqueries — counted, not substring-matched,
    // so a dropped subquery tenant filter fails this (audit-tenancy F-8).
    expect((qual.match(/app_current_tenant\(\)/g) ?? []).length).toBe(3);

    // WRITE half (audit-tenancy F-1): tenant-only WITH CHECK is not a backstop. Writes pin
    // author identity, the author's stream, an in-tenant lead (owned + live for partners),
    // and an in-tenant assignee.
    expect(wc).toContain("app_current_user");
    expect(wc).toContain("author_role");
    expect(wc).toContain("assigned_to_user_id");
    expect(wc).toMatch(/COALESCE\(.*manual_partner_id.*partner_id.*\)/i);
    // Row + assignee subquery + admin-arm lead subquery + partner-arm lead subquery.
    expect((wc.match(/app_current_tenant\(\)/g) ?? []).length).toBe(4);
  });

  it("TSK-09: RLS is enabled on lead_tasks", async () => {
    const rows = await db.execute<{ relrowsecurity: boolean }>(sql`
      select relrowsecurity from pg_class where relname = 'lead_tasks'
    `);
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("TSK-07/08: the partial open-due index exists (sweep + grouping scan path)", async () => {
    const rows = await db.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes where tablename = 'lead_tasks' and indexname = 'lead_tasks_open_due_idx'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].indexdef).toMatch(/WHERE.*done_at IS NULL/i);
  });
});
