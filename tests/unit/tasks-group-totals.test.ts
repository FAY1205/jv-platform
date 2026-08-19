import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DUE_GROUP_CONDITIONS } from "@/modules/tasks/tasks";
import { DUE_GROUPS, groupByDue, utcDateString, type DueGroup } from "@/modules/tasks/dates";

// N3C-03/C-60 — the drift guard between the two places that decide a task's due bucket.
//
// `groupByDue` (pure, per ROW) stays the single source of truth for where a row renders.
// `DUE_GROUP_CONDITIONS` (SQL, per BUCKET) counts the same buckets across every page so
// "N overdue" can be the true total instead of the current page's. They are two expressions
// of one rule, in two languages — precisely the shape that silently drifts apart (someone
// "fixes" `<` to `<=` on one side and the badge starts disagreeing with the list under it).
//
// So this test does not re-implement the rule: it RENDERS the real SQL fragments, reads the
// comparison each one actually contains, and replays it against the boundary dates. A
// changed operator, a swapped bucket, or an unrecognised condition shape all fail here.

const dialect = new PgDialect();
const render = (g: DueGroup, today: string) => dialect.sqlToQuery(DUE_GROUP_CONDITIONS[g](today)).sql;

/** Replay a rendered bucket condition in JS. `due_on` is a calendar `date` and `today` is a
 *  zero-padded ISO string, so string comparison IS the calendar comparison Postgres performs
 *  (the property dates.ts documents and relies on). Anything this can't recognise throws
 *  rather than quietly reporting "no match". */
function matches(renderedSql: string, dueOn: string | null, today: string): boolean {
  if (/is null/i.test(renderedSql)) return dueOn === null;
  if (dueOn === null) return false; // every comparison against NULL is NULL ⇒ not counted
  if (/"due_on"\s*<\s*\$/.test(renderedSql)) return dueOn < today;
  if (/"due_on"\s*>\s*\$/.test(renderedSql)) return dueOn > today;
  if (/"due_on"\s*=\s*\$/.test(renderedSql)) return dueOn === today;
  throw new Error(`Unrecognised due-bucket condition — the SQL and groupByDue can no longer be compared: ${renderedSql}`);
}

describe("N3C-03/C-60: server-side task group totals", () => {
  const today = utcDateString(new Date("2026-08-19T12:00:00Z"));
  // Boundary dates: either side of today, today itself, and the no-due-date case.
  const cases: (string | null)[] = ["2026-08-18", today, "2026-08-20", null];

  it("N3C-03/C-60: SQL group totals agree with groupByDue on boundary dates", () => {
    expect(today).toBe("2026-08-19");
    for (const dueOn of cases) {
      const hit = DUE_GROUPS.filter((g) => matches(render(g, today), dueOn, today));
      // Exactly one bucket, or the buckets would double-count (or lose) a task: this is the
      // leg that catches a `<` widened to `<=`.
      expect(hit, `dueOn=${dueOn}`).toHaveLength(1);
      expect(hit[0], `dueOn=${dueOn}`).toBe(groupByDue(dueOn, today));
    }
  });

  it("N3C-03/C-60: every bucket's condition is a comparison on due_on against the injected today", () => {
    for (const g of DUE_GROUPS) {
      const sql = render(g, today);
      expect(sql).toContain('"due_on"');
      // The date lives in a BOUND parameter, never interpolated into the statement.
      expect(sql).not.toContain(today);
      if (g !== "none") expect(sql).toContain("$1");
    }
    // The parameter is the injected clock's date, not a fresh one.
    expect(dialect.sqlToQuery(DUE_GROUP_CONDITIONS.overdue(today)).params).toEqual([today]);
  });

  it("N3C-03/C-60: the four buckets cover every due date exactly once (no gap, no overlap)", () => {
    const spread = ["2020-01-01", "2026-08-18", today, "2026-08-20", "2099-12-31", null];
    for (const dueOn of spread) {
      const hit = DUE_GROUPS.filter((g) => matches(render(g, today), dueOn, today));
      expect(hit, `dueOn=${dueOn}`).toHaveLength(1);
    }
  });
});
