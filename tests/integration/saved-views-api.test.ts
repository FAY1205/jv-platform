import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import {
  listSavedViews, createSavedView, updateSavedView, deleteSavedView,
  DuplicateSavedViewNameError, SavedViewNotFoundError, SavedViewLimitError, SAVED_VIEWS_MAX,
} from "@/modules/saved-views/saved-views";
import { CreateSavedViewSchema, EMPTY_SAVED_VIEW_FILTERS, savedViewKey } from "@/modules/saved-views/schema";

// WP-SV-1 / SV-05 (live): the command layer against a real database — CRUD, the
// case-insensitive per-user duplicate rule the unique index enforces, the OVERWRITE path, and
// what actually lands in the jsonb column (the blob is validated, normalized and stripped
// BEFORE it is stored, so what a later read applies is never what a client happened to send).
// Self-skips without DATABASE_URL. Run with node --env-file=.env.local.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG = "test-saved-views-api";

suite("WP-SV-1: saved-view commands", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  const userId = randomUUID();
  let scope: ScopeContext;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await db.delete(schema.savedViews).where(inArray(schema.savedViews.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    db = getDb();
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Views API", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    await db.insert(schema.users).values({ id: userId, tenantId, email: "admin@views-api.test", role: "admin" });
    scope = { tenantId, role: "admin", userId };
  });

  afterAll(async () => {
    await cleanup();
  });

  /** Every suite leg starts from a known-empty menu. */
  async function reset() {
    for (const v of await listSavedViews(scope)) await deleteSavedView(scope, v.id);
  }

  it("SV-02: create → list → rename → delete, all through the caller's own scope", async () => {
    await reset();
    const made = await createSavedView(scope, { name: "Hot in AZ", filters: { ...EMPTY_SAVED_VIEW_FILTERS, hot: true, state: "AZ" } });
    const [listed] = await listSavedViews(scope);
    expect(listed).toMatchObject({ id: made.id, name: "Hot in AZ" });
    expect(listed.filters).toMatchObject({ hot: true, state: "AZ" });
    expect(listed.updatedAt).toEqual(expect.any(String));

    await updateSavedView(scope, made.id, { name: "Hot in Arizona" });
    expect((await listSavedViews(scope)).map((v) => v.name)).toEqual(["Hot in Arizona"]);

    await deleteSavedView(scope, made.id);
    expect(await listSavedViews(scope)).toHaveLength(0);
    // Deleting twice is a 404, not a silent success — the second call has nothing to remove.
    await expect(deleteSavedView(scope, made.id)).rejects.toBeInstanceOf(SavedViewNotFoundError);
  });

  it("SV-01: a duplicate name is refused CASE-INSENSITIVELY (the index is the only check)", async () => {
    await reset();
    await createSavedView(scope, { name: "Probate follow-ups", filters: EMPTY_SAVED_VIEW_FILTERS });
    for (const name of ["Probate follow-ups", "PROBATE FOLLOW-UPS", "probate Follow-Ups"]) {
      await expect(createSavedView(scope, { name, filters: EMPTY_SAVED_VIEW_FILTERS }), name)
        .rejects.toBeInstanceOf(DuplicateSavedViewNameError);
    }
    // …and a RENAME onto an existing name is refused the same way.
    const other = await createSavedView(scope, { name: "Unmatched this week", filters: EMPTY_SAVED_VIEW_FILTERS });
    await expect(updateSavedView(scope, other.id, { name: "probate follow-ups" }))
      .rejects.toBeInstanceOf(DuplicateSavedViewNameError);
    expect(await listSavedViews(scope)).toHaveLength(2); // nothing was created or clobbered
  });

  it("SV-03: the OVERWRITE path re-saves filters onto the SAME row (no duplicate, no new id)", async () => {
    await reset();
    const made = await createSavedView(scope, { name: "My book", filters: EMPTY_SAVED_VIEW_FILTERS });
    const next = { ...EMPTY_SAVED_VIEW_FILTERS, hot: true, tags: [randomUUID()], viewMode: "board" as const };

    await updateSavedView(scope, made.id, { filters: next });

    const views = await listSavedViews(scope);
    expect(views).toHaveLength(1);
    expect(views[0].id).toBe(made.id); // overwritten, not replaced
    expect(savedViewKey(views[0].filters)).toBe(savedViewKey(next));
  });

  it("SV-02: the STORED blob is the validated one — unknown keys never reach jsonb", async () => {
    await reset();
    // The route parses with the same schema; here the command is handed a parsed blob, so the
    // probe goes through CreateSavedViewSchema exactly as an HTTP body would.
    const parsed = CreateSavedViewSchema.parse({
      name: "Sanitized",
      filters: { q: " cactus ", hot: "1", evil: "<script>", pageSize: 9999, state: "az" },
    });
    const made = await createSavedView(scope, parsed);

    const [row] = await db.select({ filters: schema.savedViews.filters, userId: schema.savedViews.userId, tenantId: schema.savedViews.tenantId })
      .from(schema.savedViews).where(eq(schema.savedViews.id, made.id));
    expect(Object.keys(row.filters as object).sort()).toEqual(
      ["dateFrom", "dateTo", "hot", "partnerId", "q", "source", "state", "statuses", "tags", "viewMode"],
    );
    expect(row.filters).toMatchObject({ q: "cactus", hot: true, state: "AZ" });
    // SV-02: identity comes from the SCOPE, and nothing else ever writes these two columns.
    expect(row.userId).toBe(userId);
    expect(row.tenantId).toBe(tenantId);
  });

  it("SV-02: a blob written OUT OF BAND degrades on read instead of breaking the menu", async () => {
    await reset();
    // No app path produces this — which is exactly why the read-side revalidation is worth
    // pinning: a blob outlives the schema that wrote it.
    const [row] = await db
      .insert(schema.savedViews)
      .values({ tenantId, userId, name: "Legacy", filters: { q: "kept", removedFilter: "gone", hot: "yes" } })
      .returning({ id: schema.savedViews.id });
    const [read] = await listSavedViews(scope);
    expect(read.id).toBe(row.id);
    expect(read.filters).toEqual({ ...EMPTY_SAVED_VIEW_FILTERS, q: "kept", statuses: [], hot: false });
  });

  it("SV-05: a view holding a DELETED tag id still applies — it just matches nothing", async () => {
    await reset();
    // The tags param validator drops anything that isn't uuid-shaped; a deleted-but-valid id
    // survives into the filter and simply selects no leads (any-of over zero matches). The
    // view is still openable, renameable and re-saveable, which is the graceful part.
    const deletedTagId = randomUUID();
    const made = await createSavedView(scope, {
      name: "Stale tag",
      filters: { ...EMPTY_SAVED_VIEW_FILTERS, tags: [deletedTagId, "not-a-uuid" as string] as string[] },
    });
    const [read] = await listSavedViews(scope);
    expect(read.id).toBe(made.id);
    expect(read.filters.tags).toEqual([deletedTagId]); // the malformed one was dropped at write
    await updateSavedView(scope, made.id, { filters: EMPTY_SAVED_VIEW_FILTERS }); // and it re-saves cleanly
    expect((await listSavedViews(scope))[0].filters.tags).toEqual([]);
  });

  it("SV-01/tenancy F-1: the per-user view budget is a real bound", async () => {
    await reset();
    // Seeded directly: the cap is what is under test, not 100 round trips through the command.
    await db.insert(schema.savedViews).values(
      Array.from({ length: SAVED_VIEWS_MAX }, (_, i) => ({
        tenantId,
        userId,
        name: `Bulk ${i}`,
        filters: EMPTY_SAVED_VIEW_FILTERS,
      })),
    );
    await expect(createSavedView(scope, { name: "One too many", filters: EMPTY_SAVED_VIEW_FILTERS }))
      .rejects.toBeInstanceOf(SavedViewLimitError);
    // Refused, not silently dropped — and nothing was written.
    const after = await db.select({ id: schema.savedViews.id }).from(schema.savedViews).where(eq(schema.savedViews.userId, userId));
    expect(after).toHaveLength(SAVED_VIEWS_MAX);

    // The read is capped too, so even a roster that predates the rule stays a bounded payload.
    expect(await listSavedViews(scope)).toHaveLength(SAVED_VIEWS_MAX);

    // Deleting one frees the budget — the message tells the truth.
    await deleteSavedView(scope, after[0].id);
    const made = await createSavedView(scope, { name: "One too many", filters: EMPTY_SAVED_VIEW_FILTERS });
    expect(made.id).toBeTruthy();
  });

  it("tenancy F-8: the degraded-blob fallback is a CLONE, never a shared singleton", async () => {
    await reset();
    await db.insert(schema.savedViews).values({ tenantId, userId, name: "Junk", filters: "garbage" });
    const [first] = await listSavedViews(scope);
    // What a caller is free to do with a returned array — and what would corrupt the default
    // for every later request in this process if the fallback were the module-level constant.
    first.filters.statuses.push("Mutated");
    first.filters.tags.push("mutated");

    const [second] = await listSavedViews(scope);
    expect(second.filters.statuses).not.toContain("Mutated");
    expect(second.filters.tags).toEqual([]);
    expect(EMPTY_SAVED_VIEW_FILTERS.statuses).not.toContain("Mutated");
  });

  it("SV-03: the menu orders by most-recently-saved first", async () => {
    await reset();
    const first = await createSavedView(scope, { name: "Oldest", filters: EMPTY_SAVED_VIEW_FILTERS });
    await createSavedView(scope, { name: "Newest", filters: EMPTY_SAVED_VIEW_FILTERS });
    expect((await listSavedViews(scope)).map((v) => v.name)).toEqual(["Newest", "Oldest"]);
    // Re-saving floats a view back to the top — where the eye goes back to.
    await updateSavedView(scope, first.id, { filters: { ...EMPTY_SAVED_VIEW_FILTERS, hot: true } });
    expect((await listSavedViews(scope)).map((v) => v.name)).toEqual(["Oldest", "Newest"]);
  });
});
