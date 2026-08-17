// C-33: the void grace window + distribution-hold time logic, hoisted to lib/ so the scope guard
// (lib/scope.ts) depends only on lib primitives, not on a business module (was @/modules/run).
// PURE + client-safe (no DB/fetch imports) so BOTH the server (voidUpload) and the import-detail UI
// share one definition. The drizzle read predicate lives separately in lib/hold-filter.ts so this
// file stays free of drizzle/schema and the client bundle never drags them in via the window value.
//
// Origin: WP-J1 / ING-09 (void window) + its ING-09 follow-on distribution hold. Re-exported from
// src/modules/run/{void-window,hold-window}.ts for the existing call sites.

/** A run may be voided only within this grace window of its import (uploads.createdAt).
 *  ⚠️ PAIRED EDIT (audit-tenancy F-2): the distribution hold reuses this window, and migration
 *  0047 hardcodes it as the RLS literal `interval '5 minutes'` in the lead_tasks_scope /
 *  lead_notes_scope partner arms. Changing this value REQUIRES updating that interval in a new
 *  migration too, or the app guard and its RLS backstop silently desync (releasedLeads follows
 *  this constant; the RLS backstop would not). */
export const VOID_WINDOW_MS = 5 * 60 * 1000; // 5 minutes (owner decision 2026-08-01; was 10)

/** Grace window (pure; `now` injected). Clock skew that puts createdAt slightly in the future
 *  (elapsed < 0) still counts as within the window. */
export function isWithinVoidWindow(createdAt: Date, now: Date, windowMs = VOID_WINDOW_MS): boolean {
  return now.getTime() - createdAt.getTime() <= windowMs;
}

/** Leads are held from partners for exactly the void window (kept in lockstep) — so a within-window
 *  void is clean (the leads were never partner-visible). The gate is computed at read time from the
 *  lead's created_at, so it self-releases on schedule regardless of any background job. */
export const HOLD_WINDOW_MS = VOID_WINDOW_MS;

/** True while a lead is still held from its partner (within the window of its import). Reuses the
 *  void-window predicate so "held" and "voidable" are the identical window. Pure. */
export function isHeld(createdAt: Date, now: Date, windowMs: number = HOLD_WINDOW_MS): boolean {
  return isWithinVoidWindow(createdAt, now, windowMs);
}

/** Read gate: a lead whose `created_at` is STRICTLY BEFORE this cutoff is released (partner-
 *  visible). The strict `<` is the exact complement of isHeld's inclusive boundary, so
 *  held ⟺ not released. Partner reads filter `lt(leads.createdAt, releaseCutoff(now))`. Pure. */
export function releaseCutoff(now: Date, windowMs: number = HOLD_WINDOW_MS): Date {
  return new Date(now.getTime() - windowMs);
}
