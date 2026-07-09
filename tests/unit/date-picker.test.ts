import { describe, expect, it } from "vitest";
import { isoToDate, dateToIso } from "@/components/DatePicker";

// The DatePicker converts ISO yyyy-mm-dd ↔ Date in LOCAL time so the calendar day
// never shifts across a timezone (a common date-picker bug). Round-trip must be stable.
describe("DatePicker date conversion (local, no tz shift)", () => {
  it("round-trips yyyy-mm-dd through Date without shifting the day", () => {
    for (const iso of ["2026-01-01", "2026-07-09", "2026-12-31", "2026-03-01"]) {
      const d = isoToDate(iso)!;
      expect(dateToIso(d)).toBe(iso);
    }
  });

  it("returns undefined for empty/invalid input", () => {
    expect(isoToDate(null)).toBeUndefined();
    expect(isoToDate("")).toBeUndefined();
    expect(isoToDate("not-a-date")).toBeUndefined();
  });

  it("builds a local Date at midnight for the given calendar day", () => {
    const d = isoToDate("2026-07-09")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // 0-indexed July
    expect(d.getDate()).toBe(9);
  });
});
