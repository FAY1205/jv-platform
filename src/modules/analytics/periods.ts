// ─────────────────────────────────────────────────────────────────────────────
// Time-based analytics (ANA-01): calendar periods, period-over-period deltas,
// and weekly bucketing. PURE — `now` is always injected, never read (PRN-01);
// the single home of these numbers (PRN-15). All boundaries are UTC calendar
// periods; ISO weeks start Monday. Deltas compare the current period-to-date
// with the SAME elapsed span of the previous period ("vs the same point last
// week") so a partial week never reads as a drop against a full one.
// ─────────────────────────────────────────────────────────────────────────────

export type Period = "week" | "month" | "year" | "all";

export interface PeriodLead {
  receivedAt: string;
  mlsStatus: "kept" | "removed";
  partnerId: string | null;
  previouslyMatched: boolean;
}

export interface PeriodTotals {
  total: number;
  delivered: number;
  unmatched: number;
  removed: number;
  previouslyMatched: number;
}

export interface PeriodRange {
  start: Date;
  end: Date;
  prevStart: Date | null;
  prevEnd: Date | null;
}

export interface PeriodSummary {
  period: Period;
  range: { start: string; end: string };
  totals: PeriodTotals;
  prevTotals: PeriodTotals | null;
  deltas: { total: number | null; delivered: number | null; unmatched: number | null; removed: number | null };
}

export interface WeekBucket {
  /** UTC Monday of the ISO week, as YYYY-MM-DD. */
  weekStart: string;
  total: number;
  delivered: number;
  unmatched: number;
  removed: number;
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** UTC Monday 00:00 of the ISO week containing `d`. */
function isoWeekStart(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - day);
  return start;
}

export function periodRange(period: Period, now: Date): PeriodRange {
  if (period === "all") {
    return { start: new Date(0), end: now, prevStart: null, prevEnd: null };
  }
  let start: Date;
  let prevStart: Date;
  if (period === "week") {
    start = isoWeekStart(now);
    prevStart = new Date(start.getTime() - WEEK);
  } else if (period === "month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    prevStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
  }
  const elapsed = now.getTime() - start.getTime();
  return { start, end: now, prevStart, prevEnd: new Date(prevStart.getTime() + elapsed) };
}

function emptyTotals(): PeriodTotals {
  return { total: 0, delivered: 0, unmatched: 0, removed: 0, previouslyMatched: 0 };
}

function tally(leads: readonly PeriodLead[], from: Date, to: Date): PeriodTotals {
  const t = emptyTotals();
  for (const lead of leads) {
    const at = new Date(lead.receivedAt).getTime();
    if (at < from.getTime() || at >= to.getTime()) continue;
    t.total += 1;
    if (lead.mlsStatus === "removed") t.removed += 1;
    else if (lead.partnerId !== null) t.delivered += 1;
    else t.unmatched += 1;
    if (lead.previouslyMatched) t.previouslyMatched += 1;
  }
  return t;
}

export function buildPeriodSummary(
  leads: readonly PeriodLead[],
  period: Period,
  now: Date,
): PeriodSummary {
  const range = periodRange(period, now);
  // `tally` excludes the end instant (at >= to skips); nudge by 1ms so a lead
  // stamped exactly `now` still counts in the current period.
  const endInclusive = new Date(range.end.getTime() + 1);
  const totals = tally(leads, range.start, endInclusive);
  const prevTotals =
    range.prevStart && range.prevEnd ? tally(leads, range.prevStart, range.prevEnd) : null;
  const delta = (cur: number, prev: number | undefined): number | null =>
    prevTotals === null || prev === undefined ? null : cur - prev;
  return {
    period,
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    totals,
    prevTotals,
    deltas: {
      total: delta(totals.total, prevTotals?.total),
      delivered: delta(totals.delivered, prevTotals?.delivered),
      unmatched: delta(totals.unmatched, prevTotals?.unmatched),
      removed: delta(totals.removed, prevTotals?.removed),
    },
  };
}

const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Weekly series across all provided leads; weeks with no leads appear as zero
 *  buckets so a skipped import week is VISIBLE, not silently elided. */
export function bucketByWeek(leads: readonly PeriodLead[]): WeekBucket[] {
  if (leads.length === 0) return [];
  const byWeek = new Map<string, WeekBucket>();
  let min = Infinity;
  let max = -Infinity;
  for (const lead of leads) {
    const start = isoWeekStart(new Date(lead.receivedAt));
    const key = dateKey(start);
    min = Math.min(min, start.getTime());
    max = Math.max(max, start.getTime());
    const b = byWeek.get(key) ?? { weekStart: key, total: 0, delivered: 0, unmatched: 0, removed: 0 };
    b.total += 1;
    if (lead.mlsStatus === "removed") b.removed += 1;
    else if (lead.partnerId !== null) b.delivered += 1;
    else b.unmatched += 1;
    byWeek.set(key, b);
  }
  const out: WeekBucket[] = [];
  for (let t = min; t <= max; t += WEEK) {
    const key = dateKey(new Date(t));
    out.push(byWeek.get(key) ?? { weekStart: key, total: 0, delivered: 0, unmatched: 0, removed: 0 });
  }
  return out;
}
