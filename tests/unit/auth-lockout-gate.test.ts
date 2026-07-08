import { describe, it, expect } from "vitest";
import { lockoutGate } from "@/lib/auth/lockout";

// AUT-04: the pre-attempt gate composes lockoutState (count → progressive delay)
// with the time elapsed since the last failure, so a lock lifts once its delay has
// passed. Pure and deterministic.
describe("AUT-04: lockout gate (count + time-since-last-failure)", () => {
  it("never locks within the free-attempt allowance", () => {
    expect(lockoutGate(4, 0)).toEqual({ locked: false, retryAfterMs: 0 });
  });

  it("locks at the first over-limit failure and reports the remaining delay", () => {
    // failedCount 5 → 30s base delay; just failed (0ms elapsed) → fully locked.
    const g = lockoutGate(5, 0);
    expect(g.locked).toBe(true);
    expect(g.retryAfterMs).toBe(30_000);
  });

  it("counts down the delay as time passes since the last failure", () => {
    expect(lockoutGate(5, 10_000)).toEqual({ locked: true, retryAfterMs: 20_000 });
  });

  it("lifts the lock once the delay has fully elapsed", () => {
    expect(lockoutGate(5, 30_001)).toEqual({ locked: false, retryAfterMs: 0 });
  });

  it("escalates the delay with more failures (exponential backoff)", () => {
    expect(lockoutGate(6, 0).retryAfterMs).toBe(60_000); // over=2 → 30s*2
    expect(lockoutGate(7, 0).retryAfterMs).toBe(120_000); // over=3 → 30s*4
  });
});
