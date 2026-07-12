import { describe, it, expect } from "vitest";
import { isWithinVoidWindow, VOID_WINDOW_MS } from "@/modules/run/void-window";

// WP-J1 / ING-09: a run may be voided only within a grace window of its import (createdAt).
// Pure — `now` is injected. The window guardrail bounds the (WP-J2) destructive recall to
// right after an import, so a stale run can't be yanked from a partner mid-work.
describe("isWithinVoidWindow (ING-09 grace window)", () => {
  const created = new Date("2026-07-08T12:00:00.000Z");
  const at = (ms: number) => new Date(created.getTime() + ms);

  it("ING-09: the void window is 10 minutes", () => {
    expect(VOID_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("ING-09: void is allowed within the 10-minute window (boundary inclusive)", () => {
    expect(isWithinVoidWindow(created, at(0))).toBe(true);
    expect(isWithinVoidWindow(created, at(5 * 60 * 1000))).toBe(true);
    expect(isWithinVoidWindow(created, at(VOID_WINDOW_MS))).toBe(true);
  });

  it("ING-09: void is rejected once the 10-minute window has closed", () => {
    expect(isWithinVoidWindow(created, at(VOID_WINDOW_MS + 1))).toBe(false);
    expect(isWithinVoidWindow(created, at(11 * 60 * 1000))).toBe(false);
  });

  it("ING-09: clock skew (createdAt slightly in the future) still counts as within the window", () => {
    expect(isWithinVoidWindow(created, at(-30 * 1000))).toBe(true);
  });

  it("ING-09: respects a custom window length", () => {
    expect(isWithinVoidWindow(created, at(20 * 1000), 30 * 1000)).toBe(true);
    expect(isWithinVoidWindow(created, at(60 * 1000), 30 * 1000)).toBe(false);
  });
});
