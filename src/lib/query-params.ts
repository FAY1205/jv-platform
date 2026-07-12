import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Shared API query-param primitives (validated at the boundary — API standards).
// One canonical definition consumed by admin schemas and portal routes alike.
// ─────────────────────────────────────────────────────────────────────────────

/** Page number: coerce → floor → >=1 else 1, optionally clamped to `max`.
 *  Graceful (never 400), matching "invalid filters degrade to defaults".
 *  `.parse(searchParams.get("page"))` handles string | null; missing → 1. */
export function pageParam(opts?: { max?: number }) {
  return z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    let p = Number.isFinite(n) && n >= 1 ? n : 1;
    if (opts?.max != null && p > opts.max) p = opts.max;
    return p;
  });
}

/** Rows per page — whitelisted to {10,20,50}, default 20 (mirrors Pagination.PAGE_SIZES). */
export function pageSizeParam() {
  return z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    return n === 10 || n === 50 ? n : 20;
  });
}

/** Portal list ceiling — a partner's data is inherently bounded, so this never
 *  affects legitimate paging; it bounds pathological `?page=<huge>` (esp. the
 *  listPartnerActivity in-memory window). Admin stays uncapped. */
export const PORTAL_MAX_PAGE = 1000;
