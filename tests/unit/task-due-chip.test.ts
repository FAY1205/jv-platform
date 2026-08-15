import { describe, it, expect } from "vitest";
import { dueChipFor } from "@/lib/task-due-chip";

// WP-TSK-4 / TSK-04 / PRN-14: the due-chip {tone,label} mapping is a pure function of
// (dueOn, doneAt, today) — no Date.now() here, and every tone carries an accompanying
// text label so the state never relies on color alone.

describe("TSK-04/PRN-14: dueChipFor — the due-date chip state for one task", () => {
  it("an overdue open task is danger-toned, labeled with the date", () => {
    expect(dueChipFor("2026-08-14", null, "2026-08-15")).toEqual({ tone: "danger", label: "Overdue · Aug 14" });
  });

  it("a task due today is warn-toned, labeled 'Due today' (no date repeated)", () => {
    expect(dueChipFor("2026-08-15", null, "2026-08-15")).toEqual({ tone: "warn", label: "Due today" });
  });

  it("a future-due open task is neutral, labeled with the date", () => {
    expect(dueChipFor("2026-08-18", null, "2026-08-15")).toEqual({ tone: "neutral", label: "Aug 18" });
  });

  it("an open task with no due date is neutral, labeled 'No due date'", () => {
    expect(dueChipFor(null, null, "2026-08-15")).toEqual({ tone: "neutral", label: "No due date" });
    expect(dueChipFor(undefined, null, "2026-08-15")).toEqual({ tone: "neutral", label: "No due date" });
  });

  it("a done task is always neutral + the completion date, regardless of its due date", () => {
    expect(dueChipFor("2026-08-14", "2026-08-12T14:00:00.000Z", "2026-08-15")).toEqual({ tone: "neutral", label: "Done · Aug 12" });
    // Even a task that was overdue when completed reads as done, not overdue.
    expect(dueChipFor("2026-01-01", "2026-08-12T14:00:00.000Z", "2026-08-15")).toEqual({ tone: "neutral", label: "Done · Aug 12" });
    // Even a task with no due date at all.
    expect(dueChipFor(null, "2026-08-12T14:00:00.000Z", "2026-08-15")).toEqual({ tone: "neutral", label: "Done · Aug 12" });
  });

  it("same input ⇒ same output (no clock, no I/O)", () => {
    const a = dueChipFor("2026-08-14", null, "2026-08-15");
    const b = dueChipFor("2026-08-14", null, "2026-08-15");
    expect(a).toEqual(b);
  });
});
