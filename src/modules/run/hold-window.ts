import { VOID_WINDOW_MS, isWithinVoidWindow } from "./void-window";

// Distribution hold (ING-09 follow-on). A new import's leads are held from partners for the same
// window a void is allowed — so a within-window void is clean (the leads were never visible). PURE
// + client-safe: the partner-visibility gate is computed at read time from the lead's created_at,
// so it self-releases on schedule regardless of any background job (a dead release cron delays only
// the notification email, never lead access).

/** Leads are held from partners for exactly the void window (kept in lockstep). */
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
