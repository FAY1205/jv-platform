import { describe, expect, it } from "vitest";
import {
  periodRange,
  buildPeriodSummary,
  bucketByWeek,
  type PeriodLead,
} from "@/modules/analytics/periods";

// ANA-01: time-based dashboard math. PURE — `now` is injected, never read
// (PRN-01); all boundaries are UTC calendar periods (ISO weeks start Monday).
// Deltas compare the current period-to-date against the SAME elapsed span of
// the previous period ("vs the same point last week"), not a full-vs-partial
// comparison that would always read as a drop.

// Wed 2026-07-08 12:00Z. ISO week starts Mon 2026-07-06; month July; year 2026.
const NOW = new Date("2026-07-08T12:00:00Z");

const lead = (iso: string, over: Partial<PeriodLead> = {}): PeriodLead => ({
  receivedAt: iso,
  mlsStatus: "kept",
  partnerId: "p1",
  previouslyMatched: false,
  ...over,
});

describe("periodRange", () => {
  it("week: starts Monday 00:00 UTC; prev covers the same elapsed span last week", () => {
    const r = periodRange("week", NOW);
    expect(r.start.toISOString()).toBe("2026-07-06T00:00:00.000Z");
    expect(r.end.toISOString()).toBe(NOW.toISOString());
    expect(r.prevStart!.toISOString()).toBe("2026-06-29T00:00:00.000Z");
    // elapsed = 2.5 days → prevEnd = Wed 2026-07-01T12:00Z
    expect(r.prevEnd!.toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("month: starts on the 1st; prev is the same elapsed span of last month", () => {
    const r = periodRange("month", NOW);
    expect(r.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(r.prevStart!.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(r.prevEnd!.toISOString()).toBe("2026-06-08T12:00:00.000Z");
  });

  it("year: starts Jan 1", () => {
    const r = periodRange("year", NOW);
    expect(r.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(r.prevStart!.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("all: covers everything and has no previous period", () => {
    const r = periodRange("all", NOW);
    expect(r.start.getTime()).toBe(0);
    expect(r.prevStart).toBeNull();
    expect(r.prevEnd).toBeNull();
  });
});

describe("buildPeriodSummary", () => {
  const leads: PeriodLead[] = [
    // this week (after Mon Jul 6)
    lead("2026-07-07T10:00:00Z"), // delivered
    lead("2026-07-07T11:00:00Z", { partnerId: null }), // unmatched
    lead("2026-07-08T09:00:00Z", { mlsStatus: "removed", partnerId: null }), // removed
    // last week, INSIDE the elapsed span (Mon..Wed 12:00)
    lead("2026-06-30T10:00:00Z"),
    lead("2026-07-01T09:00:00Z"),
    // last week but AFTER the elapsed span (Thu) — must not count in prev
    lead("2026-07-02T10:00:00Z"),
    // ancient
    lead("2025-01-15T10:00:00Z", { previouslyMatched: true }),
  ];

  it("week: counts only this week's leads; prev counts the same span last week", () => {
    const s = buildPeriodSummary(leads, "week", NOW);
    expect(s.totals).toMatchObject({ total: 3, delivered: 1, unmatched: 1, removed: 1 });
    expect(s.prevTotals).toMatchObject({ total: 2, delivered: 2 });
    expect(s.deltas.total).toBe(1); // 3 vs 2
  });

  it("all: totals cover everything and deltas are null", () => {
    const s = buildPeriodSummary(leads, "all", NOW);
    expect(s.totals.total).toBe(7);
    expect(s.totals.previouslyMatched).toBe(1);
    expect(s.prevTotals).toBeNull();
    expect(s.deltas.total).toBeNull();
  });

  it("PRN-01: same input + same now ⇒ identical output", () => {
    expect(buildPeriodSummary(leads, "month", NOW)).toEqual(buildPeriodSummary(leads, "month", NOW));
  });
});

describe("bucketByWeek", () => {
  it("groups by ISO week (UTC Monday key) and fills skipped weeks with zeros", () => {
    const buckets = bucketByWeek([
      lead("2026-06-23T10:00:00Z"), // week of Mon Jun 22
      lead("2026-06-24T10:00:00Z", { mlsStatus: "removed", partnerId: null }),
      // week of Jun 29 skipped entirely — the gap must be visible
      lead("2026-07-07T10:00:00Z"), // week of Jul 6
    ]);
    expect(buckets.map((b) => b.weekStart)).toEqual(["2026-06-22", "2026-06-29", "2026-07-06"]);
    expect(buckets[0]).toMatchObject({ total: 2, delivered: 1, removed: 1 });
    expect(buckets[1]).toMatchObject({ total: 0, delivered: 0, unmatched: 0, removed: 0 });
    expect(buckets[2]).toMatchObject({ total: 1, delivered: 1 });
  });

  it("returns empty for no leads", () => {
    expect(bucketByWeek([])).toEqual([]);
  });
});
