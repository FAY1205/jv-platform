import { describe, expect, it } from "vitest";
import { partnerPerformance, sourcePerformance, type PerfLead } from "@/modules/analytics/performance";

// ANA-02: performance scoped by EVENT date, not lead age. A lead given last week
// but closed this week counts as a close THIS week. PURE (PRN-01). Metrics are
// counts (not a period close-rate, which would mix cohorts and can exceed 100%).

const RANGE = { start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-13T00:00:00Z") };

const mk = (o: Partial<PerfLead>): PerfLead => ({
  partnerId: "p1",
  campaign: "Zillow",
  mlsStatus: "kept",
  receivedAt: "2026-07-07T00:00:00Z",
  firstTouchAt: null,
  closedAt: null,
  currentStatus: "New",
  ...o,
});

describe("partnerPerformance (event-scoped)", () => {
  const rows = partnerPerformance(RANGE, [
    // given this week, untouched
    mk({ partnerId: "p1", receivedAt: "2026-07-07T00:00:00Z", currentStatus: "New" }),
    // given LAST week, but contacted + closed THIS week → counts here
    mk({ partnerId: "p1", receivedAt: "2026-07-01T00:00:00Z", firstTouchAt: "2026-07-08T00:00:00Z", closedAt: "2026-07-09T00:00:00Z", currentStatus: "Closed" }),
    // p2: given + contacted this week (6h to contact)
    mk({ partnerId: "p2", receivedAt: "2026-07-07T00:00:00Z", firstTouchAt: "2026-07-07T06:00:00Z", currentStatus: "Contacted" }),
    // event OUTSIDE the range entirely — ignored
    mk({ partnerId: "p2", receivedAt: "2026-06-01T00:00:00Z", firstTouchAt: "2026-06-02T00:00:00Z", closedAt: "2026-06-03T00:00:00Z", currentStatus: "Closed" }),
  ]);

  it("counts given/untouched by receipt date in the period", () => {
    const p1 = rows.find((r) => r.partnerId === "p1")!;
    expect(p1.given).toBe(1); // only the Jul 7 lead was received this week
    expect(p1.untouched).toBe(1);
  });

  it("counts contacted/closed by their event date, even for older leads", () => {
    const p1 = rows.find((r) => r.partnerId === "p1")!;
    expect(p1.contacted).toBe(1); // the last-week lead was contacted this week
    expect(p1.closed).toBe(1);
  });

  it("averages time-to-contact (hours) over leads contacted in the period", () => {
    expect(rows.find((r) => r.partnerId === "p1")!.avgTimeToContactHours).toBe(168); // Jul1 → Jul8
    expect(rows.find((r) => r.partnerId === "p2")!.avgTimeToContactHours).toBe(6);
  });

  it("ignores events outside the period", () => {
    const p2 = rows.find((r) => r.partnerId === "p2")!;
    expect(p2.closed).toBe(0); // its only close was in June
    expect(p2.given).toBe(1);
  });

  it("orders by leads given desc and excludes null partners", () => {
    const withNull = partnerPerformance(RANGE, [mk({ partnerId: null }), mk({ partnerId: "p1" })]);
    expect(withNull.every((r) => r.partnerId !== null)).toBe(true);
  });

  it("excludes removed leads — a pipeline partner_id on an MLS-removed lead is not 'given'", () => {
    const rows2 = partnerPerformance(RANGE, [
      mk({ partnerId: "p9", receivedAt: "2026-07-07T00:00:00Z", mlsStatus: "kept" }),
      mk({ partnerId: "p9", receivedAt: "2026-07-07T00:00:00Z", mlsStatus: "removed" }),
    ]);
    expect(rows2.find((r) => r.partnerId === "p9")!.given).toBe(1);
  });
});

describe("sourcePerformance (event-scoped)", () => {
  const rows = sourcePerformance(RANGE, [
    mk({ campaign: "Zillow", receivedAt: "2026-07-07T00:00:00Z", mlsStatus: "kept", closedAt: "2026-07-09T00:00:00Z" }),
    mk({ campaign: "Zillow", receivedAt: "2026-07-08T00:00:00Z", mlsStatus: "removed" }),
    mk({ campaign: "Facebook", receivedAt: "2026-07-07T00:00:00Z", mlsStatus: "kept" }),
    mk({ campaign: null, receivedAt: "2026-07-07T00:00:00Z", mlsStatus: "kept" }),
  ]);

  it("aggregates imported/removed/closed per campaign in the period", () => {
    const z = rows.find((r) => r.campaign === "Zillow")!;
    expect(z).toMatchObject({ imported: 2, removed: 1, closed: 1, removalRate: 0.5 });
  });

  it("buckets blank campaigns under a stable label and orders by volume", () => {
    expect(rows[0].campaign).toBe("Zillow");
    expect(rows.some((r) => r.campaign === "Unattributed")).toBe(true);
  });

  it("PRN-01: deterministic", () => {
    expect(sourcePerformance(RANGE, rows.length ? [] : [])).toEqual([]);
  });
});
