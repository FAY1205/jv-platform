// WP-J1 / ING-09 — the void grace window. PURE + client-safe (no DB/fetch imports) so BOTH
// the server (voidUpload) and the import-detail UI can share one definition of the window.

/** A run may be voided only within this grace window of its import (uploads.createdAt). */
export const VOID_WINDOW_MS = 5 * 60 * 1000; // 5 minutes (owner decision 2026-08-01; was 10)

/** Grace window (pure; `now` injected). Clock skew that puts createdAt slightly in the future
 *  (elapsed < 0) still counts as within the window. */
export function isWithinVoidWindow(createdAt: Date, now: Date, windowMs = VOID_WINDOW_MS): boolean {
  return now.getTime() - createdAt.getTime() <= windowMs;
}
