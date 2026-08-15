import { describe, it, expect } from "vitest";
import { groupByDue, utcDateString, DUE_GROUPS, type DueGroup } from "@/modules/tasks/dates";

// TSK-10: due-date grouping is a PURE function of (dueOn, today) — `today` is always
// injected, never read from the clock inside module logic (PRN-01 discipline).

describe("TSK-10: pure due-date grouping", () => {
  it("TSK-10: a past due date is overdue", () => {
    expect(groupByDue("2026-08-14", "2026-08-15")).toBe("overdue");
    expect(groupByDue("2025-01-01", "2026-08-15")).toBe("overdue");
  });

  it("TSK-10: the same calendar date is today", () => {
    expect(groupByDue("2026-08-15", "2026-08-15")).toBe("today");
  });

  it("TSK-10: a future due date is upcoming", () => {
    expect(groupByDue("2026-08-16", "2026-08-15")).toBe("upcoming");
    expect(groupByDue("2027-01-01", "2026-08-15")).toBe("upcoming");
  });

  it("TSK-10: a task with no due date groups as none", () => {
    expect(groupByDue(null, "2026-08-15")).toBe("none");
    expect(groupByDue(undefined, "2026-08-15")).toBe("none");
  });

  it("TSK-10: a malformed due date degrades to none, never throws", () => {
    expect(groupByDue("", "2026-08-15")).toBe("none");
    expect(groupByDue("not-a-date", "2026-08-15")).toBe("none");
    expect(groupByDue("2026-8-1", "2026-08-15")).toBe("none");
    // A full timestamp is not a calendar date in this contract — the column is `date`.
    expect(groupByDue("2026-08-14T00:00:00Z", "2026-08-15")).toBe("none");
  });

  it("TSK-10: month/year boundaries compare as calendar dates, not string prefixes", () => {
    expect(groupByDue("2026-07-31", "2026-08-01")).toBe("overdue");
    expect(groupByDue("2026-09-01", "2026-08-31")).toBe("upcoming");
    expect(groupByDue("2025-12-31", "2026-01-01")).toBe("overdue");
    expect(groupByDue("2027-01-01", "2026-12-31")).toBe("upcoming");
  });

  it("TSK-10: same input ⇒ same output (no clock, no I/O)", () => {
    const a = groupByDue("2026-08-15", "2026-08-15");
    const b = groupByDue("2026-08-15", "2026-08-15");
    expect(a).toBe(b);
    expect(DUE_GROUPS).toContain(a as DueGroup);
  });

  it("TSK-10: utcDateString derives the injected instant's UTC calendar date", () => {
    expect(utcDateString(new Date("2026-08-15T00:00:00Z"))).toBe("2026-08-15");
    expect(utcDateString(new Date("2026-08-15T23:59:59Z"))).toBe("2026-08-15");
    // Documented UTC semantics: a late-evening US instant is already "tomorrow" in UTC.
    expect(utcDateString(new Date("2026-08-15T23:00:00-05:00"))).toBe("2026-08-16");
  });
});
