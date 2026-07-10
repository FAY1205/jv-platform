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
});
