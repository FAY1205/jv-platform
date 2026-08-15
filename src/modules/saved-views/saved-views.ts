import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { SavedViewFiltersSchema, EMPTY_SAVED_VIEW_FILTERS, type SavedViewFilters } from "./schema";
import type { CreateSavedViewInput, UpdateSavedViewInput } from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Saved leads-page views (SV-01..05) — a NAME over the whole filter state, per USER.
//
// SCOPE (SV-02). This module owns a visibility rule the rest of the app does not have: a row
// belongs to ONE USER inside a tenant. `savedViewWhere` is that rule, and every read and write
// below goes through it — there is no function here that takes a bare id. `user_id` is only
// ever `scope.userId`: it is never read from a request body (the Zod contracts are strict and
// reject a smuggled one), never taken from a query param, and never updatable. The predicate
// lives HERE rather than in lib/scope.ts, following the notifications precedent (`mine` in
// modules/notify/notifications.ts) — scope.ts holds the builders shared across modules; a
// per-user pin used by exactly one module is not a shared rule, and hoisting it would suggest
// other tables carry the axis. The RLS policy `saved_views_scope` (migration 0043) carries the
// identical predicate on BOTH halves — keep the two in lockstep.
//
// ADMIN-ONLY in v1, enforced HERE as well as at the route (the tags/tasks house standard).
// The reasoning: the routes' `requireAdminResponse` is the product gate, but a saved view is
// USER data — a partner call that slipped past a future un-gated caller would not error
// loudly, it would quietly CREATE a row that only that partner can ever see, i.e. a silent
// write to a table nobody audits for partner rows. A guard that costs one comparison removes
// that whole class. It is also honest about the v1 decision: partners have no admin-leads
// filter state to save (their portal list has its own, much smaller, filter surface). If
// partner-facing views are ever decided, this becomes a role ARM plus a portal filter blob —
// never a relaxed guard.
//
// DM-08 is N/A: a saved view is a personal UI bookmark, not a RULES table (patterns, coverage,
// recodes, Source Profiles). Nothing about routing, MLS verdicts or scoring reads one, so a
// save/rename/delete produces no rules snapshot.
//
// NO audit_log entries, and no seed. Saved views are private UI preferences with zero
// compliance surface — an operator naming their own filter bookmark is not an act the trail
// exists to record (the TAG-07 instinct, one step further: tags at least change what other
// admins see, a view changes nothing but its owner's screen). Seeding is inapplicable for the
// same reason: there is no such thing as a demo user's personal bookmark.
// ─────────────────────────────────────────────────────────────────────────────

export class SavedViewNotFoundError extends Error {
  constructor(id: string) {
    super(`Saved view ${id} not found.`);
    this.name = "SavedViewNotFoundError";
  }
}

/** SV-01: view names are unique per USER, case-insensitively. */
export class DuplicateSavedViewNameError extends Error {
  constructor(name: string) {
    super(`You already have a view called “${name}”.`);
    this.name = "DuplicateSavedViewNameError";
  }
}

/** SV-02: saved views are admin-only in v1 — a partner scope reaching this module is a
 *  programming error (the routes 403 first), not a user-facing condition. */
export class SavedViewScopeError extends Error {
  constructor() {
    super("Saved views are admin-only.");
    this.name = "SavedViewScopeError";
  }
}

/** The whole visibility rule: this tenant AND this user. Exported so tests can probe the
 *  predicate directly (the tags/tasks precedent). */
export function savedViewWhere(scope: ScopeContext) {
  return and(tenantWhere(schema.savedViews, scope), eq(schema.savedViews.userId, scope.userId))!;
}

/** The admin gate, in the module (see the header for why it is not the route's job alone). */
function assertAdmin(scope: ScopeContext): void {
  if (scope.role !== "admin") throw new SavedViewScopeError();
}

export interface SavedViewRow {
  id: string;
  name: string;
  filters: SavedViewFilters;
  updatedAt: string;
}

/** The index the case-insensitive per-user name rule is enforced by (migration 0043). */
const SAVED_VIEW_NAME_INDEX = "saved_views_user_name_idx";

/**
 * The unique index is the ONLY duplicate check: a read-then-write pre-check races two
 * concurrent saves into two rows differing only in case. Map the 23505 — but ONLY the one the
 * NAME index raised (the tags F-6 lesson): a blanket mapping would report an unrelated
 * constraint as a duplicate NAME, which on a filters-only PATCH would be nonsense. Anything
 * else propagates as the 500 it is.
 */
function asDuplicate(e: unknown, name: string | undefined): unknown {
  const info = pgErrorInfo(e);
  if (info.code !== "23505" || info.constraint !== SAVED_VIEW_NAME_INDEX || name === undefined) return e;
  return new DuplicateSavedViewNameError(name);
}

/**
 * Re-validate a stored blob on the way OUT, not just in (SV-02). The write path is the only
 * one that can produce a row today, but a blob outlives the schema that wrote it: a filter key
 * that is later removed, or a row touched by a migration, must degrade to a view the leads page
 * can still apply rather than crash the menu. Every field is optional, so an old blob simply
 * loses what no longer exists.
 */
function readFilters(raw: unknown): SavedViewFilters {
  const parsed = SavedViewFiltersSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_SAVED_VIEW_FILTERS;
}

/** SV-02 — the caller's OWN views, newest-touched first (a re-saved view floats to the top of
 *  the menu, which is where the eye goes back to). Name is the stable tiebreak. */
export async function listSavedViews(scope: ScopeContext): Promise<SavedViewRow[]> {
  assertAdmin(scope);
  const rows = await getDb()
    .select({
      id: schema.savedViews.id,
      name: schema.savedViews.name,
      filters: schema.savedViews.filters,
      updatedAt: schema.savedViews.updatedAt,
    })
    .from(schema.savedViews)
    .where(savedViewWhere(scope))
    .orderBy(desc(schema.savedViews.updatedAt), sql`lower(${schema.savedViews.name})`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    filters: readFilters(r.filters),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** SV-02 — save the current filters under a new name. tenant_id and user_id come from the
 *  scope; the body cannot carry either (the Zod contract is strict). */
export async function createSavedView(
  scope: ScopeContext,
  input: CreateSavedViewInput,
): Promise<{ id: string; name: string }> {
  assertAdmin(scope);
  try {
    const [row] = await getDb()
      .insert(schema.savedViews)
      .values({
        tenantId: scope.tenantId,
        userId: scope.userId,
        name: input.name,
        filters: input.filters,
      })
      .returning({ id: schema.savedViews.id });
    return { id: row.id, name: input.name };
  } catch (e) {
    throw asDuplicate(e, input.name);
  }
}

/**
 * SV-03 — rename and/or re-save the filters. This IS the overwrite path of
 * "Save current filters…": the client resolves the name to an id (it holds the roster) and
 * confirms, then PATCHes. POST stays a pure create, so no request is ambiguous about whether
 * it replaced someone's row.
 *
 * The UPDATE carries the full scope predicate rather than a bare id, so a foreign or another
 * user's id simply matches nothing — and `returning` is what tells us so (a 0-row update is a
 * 404, not a silent success).
 */
export async function updateSavedView(
  scope: ScopeContext,
  id: string,
  patch: UpdateSavedViewInput,
): Promise<void> {
  assertAdmin(scope);
  let updated: { id: string }[];
  try {
    updated = await getDb()
      .update(schema.savedViews)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.filters !== undefined ? { filters: patch.filters } : {}),
        // `now()`, not `new Date()`: `created_at`/`updated_at` default from the DATABASE
        // clock, and the menu is ordered by `updated_at` (SV-03). Stamping a re-save from the
        // app server's clock mixes two clocks in one ordering, so a few seconds of skew is
        // enough to sort a just-saved view BELOW one created a moment earlier. One clock.
        updatedAt: sql`now()`,
      })
      .where(and(savedViewWhere(scope), eq(schema.savedViews.id, id)))
      .returning({ id: schema.savedViews.id });
  } catch (e) {
    // A filters-only PATCH cannot collide on the name index: asDuplicate passes such an error
    // straight through rather than inventing a name clash.
    throw asDuplicate(e, patch.name);
  }
  // Outside the catch on purpose — a 404 is not a driver error to be re-mapped.
  if (updated.length === 0) throw new SavedViewNotFoundError(id);
}

/** SV-03 — delete one of the caller's own views. The confirmation is a CLIENT concern; the
 *  server does what it is told, once. A row that isn't the caller's 404s identically to one
 *  that never existed. */
export async function deleteSavedView(scope: ScopeContext, id: string): Promise<void> {
  assertAdmin(scope);
  const removed = await getDb()
    .delete(schema.savedViews)
    .where(and(savedViewWhere(scope), eq(schema.savedViews.id, id)))
    .returning({ id: schema.savedViews.id });
  if (removed.length === 0) throw new SavedViewNotFoundError(id);
}
