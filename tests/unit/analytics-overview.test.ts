import { describe, expect, it } from "vitest";
import { buildAnalytics, type AnalyticsLead, type AnalyticsRun } from "@/modules/analytics/overview";

// ANA-01: the analytics overview aggregates leads across runs into trend series
// and composition breakdowns. PURE (PRN-01) and the single home of these numbers
// (PRN-15). Partition is total = delivered + unmatched + removed.

const runs: AnalyticsRun[] = [
  { uploadId: "u2", refId: "IM-26-002", createdAt: "2026-02-01T00:00:00Z" },
  { uploadId: "u1", refId: "IM-26-001", createdAt: "2026-01-01T00:00:00Z" },
];

// u1: 2 delivered (zip→p1, state→p2), 1 unmatched, 1 removed(MLS: on market)
// u2: 1 delivered (zip→p1), 1 removed (MLS: active)
const leads: AnalyticsLead[] = [
  { uploadId: "u1", mlsStatus: "kept", matchMethod: "zip", partnerId: "p1", mlsReason: null },
  { uploadId: "u1", mlsStatus: "kept", matchMethod: "state_fallback", partnerId: "p2", mlsReason: null },
  { uploadId: "u1", mlsStatus: "kept", matchMethod: "none", partnerId: null, mlsReason: null },
  { uploadId: "u1", mlsStatus: "removed", matchMethod: "none", partnerId: null, mlsReason: "Listed on market" },
  { uploadId: "u2", mlsStatus: "kept", matchMethod: "zip", partnerId: "p1", mlsReason: null },
  { uploadId: "u2", mlsStatus: "removed", matchMethod: "none", partnerId: null, mlsReason: "Active on MLS" },
];

describe("buildAnalytics", () => {
  const a = buildAnalytics(leads, runs);

  it("ANA-01: totals partition total into delivered + unmatched + removed", () => {
    expect(a.totals.total).toBe(6);
    expect(a.totals.delivered).toBe(3);
    expect(a.totals.unmatched).toBe(1);
    expect(a.totals.removed).toBe(2);
    expect(a.totals.delivered + a.totals.unmatched + a.totals.removed).toBe(a.totals.total);
  });

  it("ANA-01: delivery and removal rates are shares of total", () => {
    expect(a.totals.deliveryRate).toBeCloseTo(3 / 6, 5);
    expect(a.totals.removalRate).toBeCloseTo(2 / 6, 5);
  });

  it("ANA-01: series is one point per run, ordered oldest first", () => {
    expect(a.series.map((s) => s.refId)).toEqual(["IM-26-001", "IM-26-002"]);
    const u1 = a.series[0];
    expect(u1).toMatchObject({ total: 4, delivered: 2, unmatched: 1, removed: 1 });
    const u2 = a.series[1];
    expect(u2).toMatchObject({ total: 2, delivered: 1, unmatched: 0, removed: 1 });
  });

  it("ANA-01: match breakdown splits kept leads by how they routed", () => {
    expect(a.matchBreakdown).toEqual({ zip: 2, stateFallback: 1, unmatched: 1 });
  });

  it("ANA-01: removal reasons are grouped and sorted by count desc", () => {
    expect(a.removalReasons).toEqual([
      { reason: "Active on MLS", count: 1 },
      { reason: "Listed on market", count: 1 },
    ]);
  });

  it("ANA-01: partner totals count delivered leads, sorted by count desc", () => {
    expect(a.partnerTotals).toEqual([
      { partnerId: "p1", count: 2 },
      { partnerId: "p2", count: 1 },
    ]);
  });

  it("ANA-01: empty input yields zeroed totals and empty series", () => {
    const e = buildAnalytics([], []);
    expect(e.totals).toEqual({ total: 0, delivered: 0, unmatched: 0, removed: 0, deliveryRate: 0, removalRate: 0 });
    expect(e.series).toEqual([]);
    expect(e.partnerTotals).toEqual([]);
  });

  it("ANA-01: removed leads with no reason fall under a stable label", () => {
    const r = buildAnalytics(
      [{ uploadId: "u1", mlsStatus: "removed", matchMethod: "none", partnerId: null, mlsReason: null }],
      [{ uploadId: "u1", refId: "IM-26-001", createdAt: "2026-01-01T00:00:00Z" }],
    );
    expect(r.removalReasons).toEqual([{ reason: "Listed on MLS", count: 1 }]);
  });

  it("PRN-01: same input produces identical output", () => {
    expect(buildAnalytics(leads, runs)).toEqual(buildAnalytics(leads, runs));
  });
});
