import { describe, expect, it } from "vitest";
import { computePartnerHealth, type HealthLead } from "@/modules/partners/health";

// ANA-02: partner accountability. Untouched leads (still "New"), how long the
// oldest has sat, and average time-to-first-touch. PURE — `now` injected
// (PRN-01). Only KEPT, currently-owned leads are considered.

const NOW = new Date("2026-07-10T00:00:00Z");

const lead = (over: Partial<HealthLead>): HealthLead => ({
  partnerId: "p1",
  receivedAt: "2026-07-01T00:00:00Z",
  currentStatus: "New",
  firstTouchAt: null,
  ...over,
});

describe("computePartnerHealth", () => {
  it("counts untouched (New) leads and the oldest untouched age in days", () => {
    const h = computePartnerHealth(NOW, [
      lead({ partnerId: "p1", receivedAt: "2026-07-01T00:00:00Z", currentStatus: "New" }), // 9d old
      lead({ partnerId: "p1", receivedAt: "2026-07-08T00:00:00Z", currentStatus: "New" }), // 2d old
      lead({ partnerId: "p1", receivedAt: "2026-07-05T00:00:00Z", currentStatus: "Closed", firstTouchAt: "2026-07-06T00:00:00Z" }),
    ]);
    expect(h.get("p1")).toMatchObject({ owned: 3, untouched: 2, oldestUntouchedDays: 9 });
  });

  it("averages time-to-first-touch (hours) over touched leads only", () => {
    const h = computePartnerHealth(NOW, [
      lead({ partnerId: "p2", receivedAt: "2026-07-01T00:00:00Z", currentStatus: "Contacted", firstTouchAt: "2026-07-01T12:00:00Z" }), // 12h
      lead({ partnerId: "p2", receivedAt: "2026-07-02T00:00:00Z", currentStatus: "Contacted", firstTouchAt: "2026-07-03T00:00:00Z" }), // 24h
      lead({ partnerId: "p2", currentStatus: "New" }), // untouched — excluded from the average
    ]);
    expect(h.get("p2")).toMatchObject({ untouched: 1, avgFirstTouchHours: 18 });
  });

  it("null avg when no lead has been touched yet; zero oldest when none untouched", () => {
    const onlyUntouched = computePartnerHealth(NOW, [lead({ partnerId: "p3", currentStatus: "New" })]);
    expect(onlyUntouched.get("p3")).toMatchObject({ untouched: 1, avgFirstTouchHours: null });
    const allClosed = computePartnerHealth(NOW, [lead({ partnerId: "p4", currentStatus: "Closed", firstTouchAt: "2026-07-02T00:00:00Z" })]);
    expect(allClosed.get("p4")).toMatchObject({ untouched: 0, oldestUntouchedDays: 0, avgFirstTouchHours: 24 });
  });

  it("keys results by partner and never crosses them", () => {
    const h = computePartnerHealth(NOW, [
      lead({ partnerId: "a", currentStatus: "New" }),
      lead({ partnerId: "b", currentStatus: "New" }),
      lead({ partnerId: "b", currentStatus: "New" }),
    ]);
    expect(h.get("a")!.untouched).toBe(1);
    expect(h.get("b")!.untouched).toBe(2);
  });

  it("PRN-01: deterministic", () => {
    const leads = [lead({ partnerId: "p1" })];
    expect(computePartnerHealth(NOW, leads)).toEqual(computePartnerHealth(NOW, leads));
  });
});
