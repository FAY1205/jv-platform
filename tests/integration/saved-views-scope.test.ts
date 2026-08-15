import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import {
  savedViewWhere, listSavedViews, createSavedView, updateSavedView, deleteSavedView,
  SavedViewNotFoundError, SavedViewScopeError,
} from "@/modules/saved-views/saved-views";
import { EMPTY_SAVED_VIEW_FILTERS } from "@/modules/saved-views/schema";

// WP-SV-1 / SV-05 (live): the saved-views isolation matrix. The NEW axis is cross-USER inside
// ONE tenant — every other table in this app is tenant- or partner-scoped, so this is the
// first place where "same tenant, same role, different person" must not see through. The
// tenant axis is probed too (it still exists), and the RLS backstop's two halves are asserted
// via pg_policies — the 0041/0042 precedent, with the user pin counted on BOTH halves.
// Self-skips without DATABASE_URL. Run with node --env-file=.env.local.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-saved-views-iso";
const SLUG_B = "test-saved-views-iso-b";

suite("SV-02: saved-view isolation + the RLS backstop", () => {
  let db: ReturnType<typeof getDb>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG, SLUG_B]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.savedViews).where(inArray(schema.savedViews.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();

    const [t] = await db.insert(schema.tenants).values({ name: "Views Iso", slug: SLUG }).returning({ id: schema.tenants.id });
    const [tb] = await db.insert(schema.tenants).values({ name: "Views Iso B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    id.tenantB = tb.id;

    // TWO admins in the SAME tenant — the axis this WP introduces.
    id.userA = randomUUID();
    id.userA2 = randomUUID();
    id.userB = randomUUID();
    await db.insert(schema.users).values([
      { id: id.userA, tenantId: t.id, email: "a1@views.test", role: "admin" as const },
      { id: id.userA2, tenantId: t.id, email: "a2@views.test", role: "admin" as const },
      { id: id.userB, tenantId: tb.id, email: "b1@views.test", role: "admin" as const },
    ]);

    const [pa] = await db
      .insert(schema.partners)
      .values({ tenantId: t.id, refId: "JV-301", name: "PA", color: "#111", status: "active" })
      .returning({ id: schema.partners.id });
    id.partner = pa.id;
    id.partnerUser = randomUUID();
    await db.insert(schema.users).values({ id: id.partnerUser, tenantId: t.id, email: "px@views.test", role: "partner", partnerId: pa.id });
  });

  afterAll(async () => {
    await cleanup();
  });

  const a1 = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.userA });
  const a2 = (): ScopeContext => ({ tenantId: id.tenant, role: "admin", userId: id.userA2 });
  const b1 = (): ScopeContext => ({ tenantId: id.tenantB, role: "admin", userId: id.userB });
  const hot = { ...EMPTY_SAVED_VIEW_FILTERS, hot: true, state: "AZ" };

  it("SV-02/SCP-01: a user sees ONLY their own views — not a COLLEAGUE's in the same tenant", async () => {
    await createSavedView(a1(), { name: "A1 Hot in AZ", filters: hot });
    await createSavedView(a2(), { name: "A2 Probate", filters: EMPTY_SAVED_VIEW_FILTERS });

    expect((await listSavedViews(a1())).map((v) => v.name)).toEqual(["A1 Hot in AZ"]);
    expect((await listSavedViews(a2())).map((v) => v.name)).toEqual(["A2 Probate"]);
    // Both rows really are in the one tenant — i.e. tenant scoping alone would have leaked.
    const all = await db.select({ id: schema.savedViews.id }).from(schema.savedViews).where(eq(schema.savedViews.tenantId, id.tenant));
    expect(all).toHaveLength(2);
  });

  it("SV-02/SCP-01: a colleague's REAL view id is invisible to every write path", async () => {
    // The oracle a randomUUID probe cannot be: a real row, in the same tenant, owned by
    // someone else (audit-tenancy F-3).
    const [theirs] = await listSavedViews(a2());
    await expect(updateSavedView(a1(), theirs.id, { name: "stolen" })).rejects.toBeInstanceOf(SavedViewNotFoundError);
    await expect(updateSavedView(a1(), theirs.id, { filters: hot })).rejects.toBeInstanceOf(SavedViewNotFoundError);
    await expect(deleteSavedView(a1(), theirs.id)).rejects.toBeInstanceOf(SavedViewNotFoundError);
    // …and it is untouched.
    const [row] = await db.select({ name: schema.savedViews.name, userId: schema.savedViews.userId })
      .from(schema.savedViews).where(eq(schema.savedViews.id, theirs.id));
    expect(row).toEqual({ name: "A2 Probate", userId: id.userA2 });
  });

  it("SV-02/SCP-01: the boundary holds ACROSS TENANTS too", async () => {
    await createSavedView(b1(), { name: "B1 Everything", filters: EMPTY_SAVED_VIEW_FILTERS });
    expect((await listSavedViews(b1())).map((v) => v.name)).toEqual(["B1 Everything"]);
    expect((await listSavedViews(a1())).map((v) => v.name)).toEqual(["A1 Hot in AZ"]);

    const [foreign] = await listSavedViews(b1());
    await expect(updateSavedView(a1(), foreign.id, { name: "stolen" })).rejects.toBeInstanceOf(SavedViewNotFoundError);
    await expect(deleteSavedView(a1(), foreign.id)).rejects.toBeInstanceOf(SavedViewNotFoundError);
  });

  it("SV-01/SCP-01: the unique name index is PER USER — a colleague's name is free (non-oracle)", async () => {
    // Guards the index's user_id column: without it this would 409, and every admin in a
    // tenant would silently share one namespace of view names.
    const made = await createSavedView(a1(), { name: "a2 probate", filters: EMPTY_SAVED_VIEW_FILTERS });
    expect(made.id).toBeTruthy();
    expect((await listSavedViews(a1())).map((v) => v.name).sort()).toEqual(["A1 Hot in AZ", "a2 probate"]);
    expect((await listSavedViews(a2())).map((v) => v.name)).toEqual(["A2 Probate"]); // untouched
    await deleteSavedView(a1(), made.id); // restore the single-view baseline
  });

  it("SV-02: the module refuses a PARTNER scope itself, not only at the route", async () => {
    const partner: ScopeContext = { tenantId: id.tenant, role: "partner", userId: id.partnerUser, partnerId: id.partner };
    await expect(listSavedViews(partner)).rejects.toBeInstanceOf(SavedViewScopeError);
    await expect(createSavedView(partner, { name: "p", filters: EMPTY_SAVED_VIEW_FILTERS })).rejects.toBeInstanceOf(SavedViewScopeError);
    await expect(updateSavedView(partner, randomUUID(), { name: "p" })).rejects.toBeInstanceOf(SavedViewScopeError);
    await expect(deleteSavedView(partner, randomUUID())).rejects.toBeInstanceOf(SavedViewScopeError);
    // Nothing was written by any of it.
    const partnerRows = await db.select({ id: schema.savedViews.id }).from(schema.savedViews).where(eq(schema.savedViews.userId, id.partnerUser));
    expect(partnerRows).toHaveLength(0);
  });

  it("SV-02: savedViewWhere pins BOTH tenant and user (the predicate itself)", async () => {
    const mine = await db.select({ name: schema.savedViews.name }).from(schema.savedViews).where(savedViewWhere(a1()));
    expect(mine.map((r) => r.name)).toEqual(["A1 Hot in AZ"]);
    // A scope that mixes tenant A with tenant B's USER matches nothing — the two halves are
    // AND-ed, so neither alone can carry the query.
    const mixed: ScopeContext = { tenantId: id.tenant, role: "admin", userId: id.userB };
    expect(await db.select({ id: schema.savedViews.id }).from(schema.savedViews).where(savedViewWhere(mixed))).toHaveLength(0);
  });

  it("SV-01/SEC-01: BOTH saved_views_scope policy halves pin tenant AND user_id", async () => {
    const rows = await db.execute<{ qual: string; with_check: string }>(sql`
      select qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'saved_views' and policyname = 'saved_views_scope'
    `);
    expect(rows.length, "saved_views_scope policy exists").toBe(1);
    for (const half of ["qual", "with_check"] as const) {
      const clause = rows[0][half];
      // Counted, not substring-matched, so a dropped predicate fails this (audit-tenancy F-8).
      expect((clause.match(/app_current_tenant\(\)/g) ?? []).length, `${half} tenant pin`).toBe(1);
      expect((clause.match(/app_current_user\(\)/g) ?? []).length, `${half} user pin`).toBe(1);
      expect(clause, `${half} user column`).toContain("user_id");
      // Both halves are conjunctions — a policy that OR-ed the two pins would be no boundary.
      expect(clause.toLowerCase(), `${half} conjunction`).toContain(" and ");
      expect(clause.toLowerCase(), `${half} has no OR`).not.toContain(" or ");
    }
  });

  it("SV-01/SEC-01: RLS is enabled on saved_views", async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select relname, relrowsecurity from pg_class where relname = 'saved_views'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].relrowsecurity).toBe(true);
  });

  it("SV-01/DM-11: the per-user case-insensitive name index and the FK-covering indexes exist", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes where tablename = 'saved_views'
    `);
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    const nameIdx = byName.get("saved_views_user_name_idx");
    expect(nameIdx).toMatch(/UNIQUE/i);
    expect(nameIdx).toMatch(/lower\(name\)/i);
    // It LEADS with user_id, which is what makes it the FK-covering index for user_id too.
    expect(nameIdx).toMatch(/\(user_id,/);
    expect(byName.has("saved_views_tenant_idx"), "tenant FK-covering index").toBe(true);
  });
});
