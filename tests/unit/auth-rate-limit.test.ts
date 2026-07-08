import { describe, it, expect } from "vitest";
import { rateDecision } from "@/lib/auth/rate-limit";

// AUT-03 / API-05: sliding-window rate limiting. Pure decision over the attempt
// timestamps already in the window; the store supplies the timestamps, this
// function decides allow/deny + Retry-After. Kept pure so it is deterministic.
describe("AUT-03: sliding-window rate decision", () => {
  const rule = { limit: 5, windowMs: 60_000 };
  const now = 1_000_000;

  it("allows when the window is empty and reports remaining", () => {
    const d = rateDecision([], now, rule);
    expect(d).toEqual({ allowed: true, remaining: 4, retryAfterMs: 0 });
  });

  it("allows the attempt that reaches the limit and reports zero remaining", () => {
    const ts = [now - 5, now - 4, now - 3, now - 2]; // 4 prior in window; this is the 5th
    const d = rateDecision(ts, now, rule);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(0);
  });

  it("blocks once the window is full and reports Retry-After from the oldest in-window attempt", () => {
    const oldest = now - 40_000;
    const ts = [oldest, now - 30_000, now - 20_000, now - 10_000, now - 5_000]; // 5 in window
    const d = rateDecision(ts, now, rule);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
    // oldest exits the window at oldest + windowMs; retry after that from now.
    expect(d.retryAfterMs).toBe(oldest + rule.windowMs - now);
  });

  it("ignores attempts older than the window", () => {
    const ts = [now - 120_000, now - 90_000, now - 61_000]; // all outside 60s window
    const d = rateDecision(ts, now, rule);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(4);
  });
});
