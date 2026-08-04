import { describe, it, expect } from "vitest";
import { statusPillClass, STATUS_PILL } from "@/lib/status-pill";

describe("DSN-03: statusPillClass", () => {
  it("SP-01: a known status yields the pill base + that status's color", () => {
    const cls = statusPillClass("Closed");
    expect(cls).toContain("rounded-full");
    expect(cls).toContain("text-xs");
    expect(cls).toContain("bg-success-soft");
    expect(cls).toContain("text-success");
    expect(cls).toBe(`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL.Closed}`);
  });

  it("SP-02: an unknown status falls back to the neutral pill color", () => {
    const cls = statusPillClass("Nonexistent");
    expect(cls).toContain("bg-surface-3");
    expect(cls).toContain("text-text-2");
  });

  it("SP-03: an extra className is appended", () => {
    expect(statusPillClass("New", "ml-auto")).toContain("ml-auto");
  });
});
