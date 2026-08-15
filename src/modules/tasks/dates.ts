// ─────────────────────────────────────────────────────────────────────────────
// Pure due-date logic for lead tasks (TSK-10). `today` is ALWAYS injected — no
// Date.now() inside module logic, so grouping is deterministic and unit-testable
// (PRN-01 discipline; the same shape src/modules/retention/purge.ts uses for `now`).
//
// `lead_tasks.due_on` is a Postgres `date` — a CALENDAR date with no timezone —
// and drizzle hands it back as a "YYYY-MM-DD" string. Comparison is therefore a
// plain calendar comparison against today's UTC date (documented in TSK-10:
// revisit only if per-tenant timezones ever land). Zero-padded ISO date strings
// order lexicographically the same way they order chronologically, so `<`/`>` on
// the strings IS the calendar comparison — no Date construction, no DST edges.
// ─────────────────────────────────────────────────────────────────────────────

/** The My Tasks buckets (TSK-07), in display order. */
export const DUE_GROUPS = ["overdue", "today", "upcoming", "none"] as const;
export type DueGroup = (typeof DUE_GROUPS)[number];

/** Strict "YYYY-MM-DD" — the exact shape a `date` column round-trips. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Bucket one task's due date relative to an injected `today` (also "YYYY-MM-DD").
 * A missing due date is "none" (a task without a deadline is neither overdue nor
 * upcoming); anything that isn't a calendar date degrades to "none" rather than
 * throwing, so one malformed row can never break a whole list render.
 */
export function groupByDue(dueOn: string | null | undefined, today: string): DueGroup {
  if (typeof dueOn !== "string" || !ISO_DATE_RE.test(dueOn)) return "none";
  if (dueOn < today) return "overdue";
  if (dueOn > today) return "upcoming";
  return "today";
}

/**
 * The UTC calendar date of an injected instant — the `today` every grouping call
 * takes. The clock stays at the adapter boundary (a route/module entry point picks
 * `now`), never inside the pure logic above.
 */
export function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}
