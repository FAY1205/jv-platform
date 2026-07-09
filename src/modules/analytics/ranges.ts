// Rolling-window analytics time model (ANA-01). PURE — `now` is always injected,
// never read (mirrors PRN-01 discipline); the single home of these numbers (PRN-15).
// Windows are trailing spans ending at `now`; the prior window is the immediately
// preceding equal-length span. Replaces the calendar-period model (periods.ts) on
// the dashboard; that path is retired in WS-9.

export type RangeKey = "7d" | "30d" | "12mo" | "all";
export const RANGE_KEYS: readonly RangeKey[] = ["7d", "30d", "12mo", "all"];

export type Bucket = "day" | "month";

export interface RangeWindow {
  start: Date;
  end: Date;
  prevStart: Date | null;
  prevEnd: Date | null;
  bucket: Bucket;
}

const DAY = 86_400_000;

/** Subtract `n` whole UTC months from `d` (day-of-month clamped by setUTCMonth). */
function minusMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() - n);
  return r;
}

export function rangeWindow(key: RangeKey, now: Date): RangeWindow {
  const end = new Date(now.getTime());
  if (key === "all") {
    return { start: new Date(0), end, prevStart: null, prevEnd: null, bucket: "month" };
  }
  if (key === "7d" || key === "30d") {
    const days = key === "7d" ? 7 : 30;
    const start = new Date(end.getTime() - days * DAY);
    const prevStart = new Date(start.getTime() - days * DAY);
    return { start, end, prevStart, prevEnd: start, bucket: "day" };
  }
  // 12mo
  const start = minusMonths(end, 12);
  const prevStart = minusMonths(end, 24);
  return { start, end, prevStart, prevEnd: start, bucket: "month" };
}

/** ANA-03: Avg Contact display. `—` when no contacted leads; hours under 2 days,
 *  otherwise days — each to one decimal. The single formatter for this figure. */
export function formatContactTime(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

export function deltaOf(cur: number, prev: number | null): number | null {
  return prev === null ? null : cur - prev;
}

/** ANA-03 / F-64: the one human definition of Avg Contact, shown in the header tooltip. */
export const AVG_CONTACT_DEFINITION =
  "Average time from a lead being distributed to a partner until that partner's first action " +
  "(a status change or note), measured only over leads acted on in the selected range. " +
  "Untouched leads are excluded — they are counted under Untouched.";
