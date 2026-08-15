import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";

// KAN-03 · the board's PURE layer. No DB, no fetch, no Date.now() — "now" is always
// injected by the caller, so days-in-status is derived in exactly ONE place (PRN-15:
// never re-derive a number elsewhere) and is trivially testable at the boundary.
// Imported by the board client component AND the query module, so nothing here may
// pull a server dependency in.

/** Days in the current status at which a card is flagged stale (owner: fixed at 14 for
 *  v1; a per-tenant setting is a future candidate, not this WP). */
export const STALE_DAYS = 14;

/** Cards fetched per column, per page (KAN-02/KAN-10 — server-side per-column paging). */
export const BOARD_PAGE_SIZE = 25;

/** Upper bound on the per-column page cursor. A column can never hold 250k leads, so
 *  this only bounds pathological `?page=<huge>` input — which must degrade, not reach
 *  the driver as a non-finite offset (audit-tenancy F-4). */
export const BOARD_MAX_PAGE = 10_000;

/** KAN-06: pointer travel (px) above which a press is a DRAG, not a click — so
 *  releasing a drag never also opens the lead dialog. */
export const DRAG_CLICK_THRESHOLD_PX = 5;

/** The board's fixed columns, in workflow order. The status vocabulary itself stays
 *  the single source of truth (SEAM-06) — the board never invents its own list. */
export const BOARD_COLUMNS = SEED_LEAD_STATUSES;

export interface BoardAge {
  /** Whole days between the last status change and `now`; never negative. */
  days: number;
  /** days >= STALE_DAYS — the amber ⚠ treatment (PRN-14: always shown WITH the label). */
  stale: boolean;
  /** The visible label, e.g. "3d in status" (or "In status today" on day 0). */
  label: string;
}

const DAY_MS = 86_400_000;

/**
 * KAN-03 — how long a card has sat in its current column.
 *
 * `statusSince` is the ISO timestamp of the lead's latest status row (or the lead's
 * createdAt when it has never moved). An unparseable value degrades to day 0 rather
 * than rendering "NaNd in status".
 */
export function boardAge(statusSince: string, now: Date): BoardAge {
  const since = new Date(statusSince).getTime();
  const at = now.getTime();
  const elapsed = Number.isFinite(since) && Number.isFinite(at) ? at - since : 0;
  const days = Math.max(0, Math.floor(elapsed / DAY_MS));
  return {
    days,
    stale: days >= STALE_DAYS,
    label: days === 0 ? "In status today" : `${days}d in status`,
  };
}
