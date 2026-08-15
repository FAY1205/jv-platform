import { describe, it, expect } from "vitest";
import { HOLD_WINDOW_MS, isHeld, releaseCutoff } from "@/modules/run/hold-window";
import { VOID_WINDOW_MS } from "@/modules/run/void-window";

// Distribution hold (ING-09 follow-on): a new import's leads are held from partners for the same
// window a void is allowed, then self-release. Pure — `now` is injected and the gate is computed at
// read time, so visibility never depends on a background job. New leads are held; reappearing leads
// (older created_at) are already released. "held" and "released" are exact complements.
describe("distribution hold window (ING-09 follow-on)", () => {
  const imported = new Date("2026-07-13T12:00:00.000Z");
  const at = (ms: number) => new Date(imported.getTime() + ms);
  // The partner read gate: a lead created STRICTLY before the cutoff is released (visible).
  const released = (createdAt: Date, now: Date) => createdAt.getTime() < releaseCutoff(now).getTime();

  it("the hold window equals the void window (5 min)", () => {
    expect(HOLD_WINDOW_MS).toBe(VOID_WINDOW_MS);
    expect(HOLD_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("TSK-08: the void window never exceeds the hold window", () => {
    // The due-task reminder's partner arm (src/modules/notify/task-reminders.ts) gates on
    // releasedLeads(), i.e. the HOLD window — and relies on a released lead no longer being
    // voidable, so a partner is never emailed about a lead that can still be recalled. That
    // holds only while the void window is no wider than the hold window. The two are aliases
    // today; this pins the direction so decoupling them can't silently open the gap.
    expect(VOID_WINDOW_MS).toBeLessThanOrEqual(HOLD_WINDOW_MS);
  });

  it("a lead is held within its window and released strictly after it (boundary held)", () => {
    expect(isHeld(imported, at(0))).toBe(true);
    expect(isHeld(imported, at(3 * 60 * 1000))).toBe(true);
    expect(isHeld(imported, at(HOLD_WINDOW_MS))).toBe(true); // exactly the window: still held (matches void window)
    expect(isHeld(imported, at(HOLD_WINDOW_MS + 1))).toBe(false);
  });

  it("held is the exact complement of released at the boundary", () => {
    expect(released(imported, at(0))).toBe(false); // just imported → held, not released
    expect(released(imported, at(HOLD_WINDOW_MS))).toBe(false); // boundary → still held
    expect(released(imported, at(HOLD_WINDOW_MS + 1))).toBe(true);
  });

  it("a reappearing lead (created well before now) is already released", () => {
    expect(isHeld(imported, at(24 * 60 * 60 * 1000))).toBe(false);
    expect(released(imported, at(24 * 60 * 60 * 1000))).toBe(true);
  });

  it("releaseCutoff is now minus the window", () => {
    const now = at(30 * 60 * 1000);
    expect(releaseCutoff(now).getTime()).toBe(now.getTime() - HOLD_WINDOW_MS);
    expect(releaseCutoff(now, 1000).getTime()).toBe(now.getTime() - 1000);
  });

  it("respects a custom window length", () => {
    const oneMin = 60 * 1000;
    expect(isHeld(imported, at(oneMin), oneMin)).toBe(true); // boundary inclusive
    expect(isHeld(imported, at(oneMin + 1), oneMin)).toBe(false);
  });
});
