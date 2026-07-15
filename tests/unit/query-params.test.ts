import { describe, it, expect } from "vitest";
import { pageParam, pageSizeParam, dateParam, PORTAL_MAX_PAGE } from "@/lib/query-params";

describe("query-params primitives", () => {
  it("FEP-03: pageParam coerces to a floored int >= 1, else 1", () => {
    const p = pageParam();
    expect(p.parse("1")).toBe(1);
    expect(p.parse("3")).toBe(3);
    expect(p.parse("2.9")).toBe(2);
    expect(p.parse(null)).toBe(1);
    expect(p.parse(undefined)).toBe(1);
    expect(p.parse("0")).toBe(1);
    expect(p.parse("-5")).toBe(1);
    expect(p.parse("abc")).toBe(1);
  });

  it("PTL-02: pageParam clamps to max when given (portal ceiling)", () => {
    const p = pageParam({ max: PORTAL_MAX_PAGE });
    expect(p.parse("5")).toBe(5);
    expect(p.parse(String(PORTAL_MAX_PAGE))).toBe(PORTAL_MAX_PAGE);
    expect(p.parse(String(PORTAL_MAX_PAGE + 1))).toBe(PORTAL_MAX_PAGE);
    expect(p.parse("999999999")).toBe(PORTAL_MAX_PAGE);
    expect(p.parse("abc")).toBe(1);
  });

  it("ACT-02: pageSizeParam whitelists {10,20,50}, default 20", () => {
    const s = pageSizeParam();
    expect(s.parse("10")).toBe(10);
    expect(s.parse("50")).toBe(50);
    expect(s.parse("20")).toBe(20);
    expect(s.parse("37")).toBe(20);
    expect(s.parse(null)).toBe(20);
    expect(s.parse(undefined)).toBe(20);
  });

  // D3 (tenancy-audit F-1): the canonical date boundary, pinned at its own level — three
  // consumers (leads + activity schemas, runs route) ride this one definition.
  it("D3: dateParam keeps a real YYYY-MM-DD, degrades everything else to undefined (no filter)", () => {
    const d = dateParam();
    expect(d.parse("2026-01-15")).toBe("2026-01-15");
    expect(d.parse("2026-02-31")).toBeUndefined(); // round-trip guard: shape-valid, impossible
    expect(d.parse("2026-13-01")).toBeUndefined(); // month out of range
    expect(d.parse("01/15/2026")).toBeUndefined(); // wrong shape
    expect(d.parse(null)).toBeUndefined();
    expect(d.parse(undefined)).toBeUndefined();
    expect(d.parse(12345)).toBeUndefined(); // non-string
  });
});
