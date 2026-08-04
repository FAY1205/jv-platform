import { describe, it, expect } from "vitest";
import { rangeWindow, formatContactTime, deltaOf, AVG_CONTACT_DEFINITION } from "@/modules/analytics/ranges";

const NOW = new Date("2026-07-10T12:00:00Z");

describe("rangeWindow (ANA-01 rolling windows)", () => {
  it("ANA-01: 7d window is the trailing 7 days, daily buckets, prior = preceding 7 days", () => {
    const w = rangeWindow("7d", NOW);
    expect(w.end.toISOString()).toBe(NOW.toISOString());
    expect(w.start.toISOString()).toBe(new Date("2026-07-03T12:00:00Z").toISOString());
    expect(w.bucket).toBe("day");
    expect(w.prevStart!.toISOString()).toBe(new Date("2026-06-26T12:00:00Z").toISOString());
    expect(w.prevEnd!.toISOString()).toBe(w.start.toISOString());
  });

  it("ANA-01: 30d window is the trailing 30 days, daily buckets", () => {
    const w = rangeWindow("30d", NOW);
    expect(w.start.toISOString()).toBe(new Date("2026-06-10T12:00:00Z").toISOString());
    expect(w.bucket).toBe("day");
    expect(w.prevStart!.toISOString()).toBe(new Date("2026-05-11T12:00:00Z").toISOString());
  });

  it("ANA-01: 12mo window is the trailing 12 months (UTC month math), monthly buckets", () => {
    const w = rangeWindow("12mo", NOW);
    expect(w.start.toISOString()).toBe(new Date("2025-07-10T12:00:00Z").toISOString());
    expect(w.bucket).toBe("month");
    expect(w.prevStart!.toISOString()).toBe(new Date("2024-07-10T12:00:00Z").toISOString());
    expect(w.prevEnd!.toISOString()).toBe(w.start.toISOString());
  });

  it("ANA-01: all-time starts at the epoch, monthly buckets, and has no prior window", () => {
    const w = rangeWindow("all", NOW);
    expect(w.start.getTime()).toBe(0);
    expect(w.bucket).toBe("month");
    expect(w.prevStart).toBeNull();
    expect(w.prevEnd).toBeNull();
  });
});

describe("formatContactTime (ANA-03)", () => {
  it("ANA-03: null → em dash", () => expect(formatContactTime(null)).toBe("—"));
  it("ANA-03: sub-48h shows hours with one decimal", () => expect(formatContactTime(3.2)).toBe("3.2h"));
  it("ANA-03: 48h+ shows days with one decimal", () => expect(formatContactTime(50)).toBe("2.1d"));
});

describe("deltaOf", () => {
  it("returns null when prior is null (all-time)", () => expect(deltaOf(5, null)).toBeNull());
  it("returns cur - prev otherwise", () => expect(deltaOf(5, 2)).toBe(3));
});

it("AVG_CONTACT_DEFINITION is a non-empty human sentence", () => {
  expect(AVG_CONTACT_DEFINITION.length).toBeGreaterThan(20);
});
