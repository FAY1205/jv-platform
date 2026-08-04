import { describe, it, expect } from "vitest";
import { buildPartnerPerformance, type PartnerLeadFact } from "@/modules/analytics/partner-performance";

const NOW = new Date("2026-07-10T12:00:00Z");
const f = (receivedAt: string, firstTouchAt: string | null, closedAt: string | null): PartnerLeadFact => ({ receivedAt, firstTouchAt, closedAt });

describe("buildPartnerPerformance (ANA-02/03)", () => {
  it("ANA-02: given/contacted/closed are range-bounded by their own event date", () => {
    const r = buildPartnerPerformance("30d", NOW, [
      f("2026-07-05T00:00:00Z", "2026-07-05T02:00:00Z", "2026-07-08T00:00:00Z"), // all in 30d
      f("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", null), // received out of 30d
    ]);
    expect(r.stats.given).toBe(1);
    expect(r.stats.contacted).toBe(1);
    expect(r.stats.closed).toBe(1);
  });

  it("ANA-02: untouched counts in-range leads with no first touch", () => {
    const r = buildPartnerPerformance("30d", NOW, [
      f("2026-07-05T00:00:00Z", null, null), // in-range, no touch → untouched
      f("2026-07-05T00:00:00Z", "2026-07-06T00:00:00Z", null), // in-range, touched
      f("2020-01-01T00:00:00Z", null, null), // out of range → not counted
    ]);
    expect(r.stats.given).toBe(2);
    expect(r.stats.contacted).toBe(1);
    expect(r.stats.untouched).toBe(1);
  });

  it("ANA-03: Avg Contact averages contacted leads only; null when none", () => {
    const r = buildPartnerPerformance("30d", NOW, [f("2026-07-05T00:00:00Z", "2026-07-05T02:00:00Z", null)]);
    expect(r.stats.avgContactHours).toBeGreaterThan(1.5);
    expect(r.stats.avgContactHours).toBeLessThan(2.5);
    const none = buildPartnerPerformance("30d", NOW, [f("2026-07-05T00:00:00Z", null, null)]);
    expect(none.stats.avgContactHours).toBeNull();
    expect(none.stats.given).toBe(1);
    expect(none.stats.contacted).toBe(0);
  });

  it("ANA-01: history zero-fills daily buckets for 30d and totals given by event date", () => {
    const r = buildPartnerPerformance("30d", NOW, [f("2026-07-05T00:00:00Z", null, null), f("2026-07-06T00:00:00Z", null, null)]);
    expect(r.range.bucket).toBe("day");
    expect(r.history.length).toBeGreaterThanOrEqual(28);
    expect(r.history.length).toBeLessThanOrEqual(32);
    expect(r.history.reduce((s, b) => s + b.given, 0)).toBe(2);
    expect(r.history.some((b) => b.given === 0)).toBe(true);
  });

  it("ANA-01: 12mo uses month buckets and counts across a year boundary", () => {
    const r = buildPartnerPerformance("12mo", NOW, [f("2025-12-15T00:00:00Z", null, null), f("2026-01-15T00:00:00Z", null, null)]);
    expect(r.range.bucket).toBe("month");
    expect(r.history.length).toBeGreaterThanOrEqual(12);
    expect(r.history.length).toBeLessThanOrEqual(14);
    expect(r.history.find((b) => b.bucketStart.startsWith("2025-12"))?.given).toBe(1);
    expect(r.history.find((b) => b.bucketStart.startsWith("2026-01"))?.given).toBe(1);
    expect(r.history.reduce((s, b) => s + b.given, 0)).toBe(2);
  });

  it("ANA-01: all-time spans the actual data (not the epoch) with month buckets", () => {
    const r = buildPartnerPerformance("all", NOW, [f("2026-01-01T00:00:00Z", null, null), f("2026-06-01T00:00:00Z", null, null)]);
    expect(r.range.bucket).toBe("month");
    expect(r.history.length).toBe(6); // Jan..Jun inclusive
    expect(r.history[0].bucketStart.startsWith("2026-01")).toBe(true);
    expect(r.history.reduce((s, b) => s + b.given, 0)).toBe(2);
  });

  it("all-time with no facts yields an empty history", () => {
    const r = buildPartnerPerformance("all", NOW, []);
    expect(r.history).toEqual([]);
    expect(r.stats.given).toBe(0);
  });

  it("PW2B-01 (ANA-02): returns prior {given,contacted,closed,untouched} for the immediately-preceding window", () => {
    const r = buildPartnerPerformance("30d", NOW, [
      // current window [now-30d, now): 2 given, 1 contacted, 1 closed, 1 untouched
      f("2026-07-05T00:00:00Z", "2026-07-05T02:00:00Z", "2026-07-08T00:00:00Z"), // given+contacted+closed
      f("2026-06-15T00:00:00Z", null, null), // given, untouched
      // prior window [now-60d, now-30d): 2 given, 1 contacted, 1 closed, 1 untouched
      f("2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z", "2026-06-03T00:00:00Z"), // prior given+contacted+closed
      f("2026-05-20T00:00:00Z", null, null), // prior given, untouched
      // out of both windows entirely
      f("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z"),
    ]);
    expect(r.prior).toEqual({ given: 2, contacted: 1, closed: 1, untouched: 1 });
  });

  it("PW2B-02: range \"all\" has no prior window ⇒ prior is null", () => {
    const r = buildPartnerPerformance("all", NOW, [f("2026-01-01T00:00:00Z", null, null)]);
    expect(r.prior).toBeNull();
  });

  it("PW2B-03: the accumulate refactor leaves current-window stats and history unchanged", () => {
    const facts = [
      f("2026-07-05T00:00:00Z", "2026-07-05T02:00:00Z", "2026-07-08T00:00:00Z"),
      f("2026-07-06T00:00:00Z", null, null),
      f("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", null), // out of 30d window
    ];
    const r = buildPartnerPerformance("30d", NOW, facts);
    expect(r.stats.given).toBe(2);
    expect(r.stats.contacted).toBe(1);
    expect(r.stats.closed).toBe(1);
    expect(r.stats.untouched).toBe(1);
    expect(r.stats.avgContactHours).toBeGreaterThan(1.5);
    expect(r.stats.avgContactHours).toBeLessThan(2.5);
    expect(r.history.length).toBeGreaterThanOrEqual(28);
    expect(r.history.length).toBeLessThanOrEqual(32);
    expect(r.history.reduce((s, b) => s + b.given, 0)).toBe(2);
  });
});
