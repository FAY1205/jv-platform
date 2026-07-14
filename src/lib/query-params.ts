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

/** Optional YYYY-MM-DD date filter — graceful: a value that fails the shape regex OR
 *  doesn't round-trip through Date (e.g. "2026-13-45") degrades to undefined (no
 *  filter), never a 400/500 (audit-tenancy F-1/F-3, 2026-07-15). Consumers pass the
 *  validated string into UTC day bounds. */
export function dateParam() {
  return z.unknown().optional().transform((v) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
  });
}

/** Portal list ceiling — a partner's data is inherently bounded, so this never
 *  affects legitimate paging; it bounds pathological `?page=<huge>` (esp. the
 *  listPartnerActivity in-memory window). Admin stays uncapped. */
export const PORTAL_MAX_PAGE = 1000;
