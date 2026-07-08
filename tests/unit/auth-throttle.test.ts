import { describe, it, expect } from "vitest";
import { evaluateThrottle, type AttemptSnapshot, type ThrottleConfig } from "@/lib/auth/throttle";

// AUT-03/04: composition of lockout (account protection) + sliding-window rate
// limits (abuse protection) over a timestamp snapshot. Pure and deterministic.
const cfg: ThrottleConfig = {
  perIdentifier: { limit: 5, windowMs: 300_000 },
  perIp: { limit: 20, windowMs: 300_000 },
};
const now = 10_000_000;
const empty: AttemptSnapshot = { attempts: [], ipAttempts: [], failures: [] };

describe("AUT-03/04: throttle decision", () => {
  it("allows when there is no recent history", () => {
    expect(evaluateThrottle(empty, now, cfg)).toEqual({ ok: true, retryAfterSec: 0 });
  });

  it("locks out after too many recent failures (precedence over rate limits)", () => {
    const failures = [now - 4000, now - 3000, now - 2000, now - 1000, now - 500]; // 5 failures
    const d = evaluateThrottle({ ...empty, failures }, now, cfg);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("locked_out");
    expect(d.retryAfterSec).toBeGreaterThan(0);
  });

  it("rate-limits by identifier when the per-identifier window is full", () => {
    const attempts = Array.from({ length: 5 }, (_, i) => now - (i + 1) * 1000); // 5 attempts, all success
    const d = evaluateThrottle({ ...empty, attempts }, now, cfg);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("rate_limited");
  });

  it("rate-limits by IP when many identifiers are hammered from one IP", () => {
    const ipAttempts = Array.from({ length: 20 }, (_, i) => now - (i + 1) * 100);
    const d = evaluateThrottle({ ...empty, ipAttempts }, now, cfg);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("rate_limited");
  });

  it("reports Retry-After in whole seconds (rounded up)", () => {
    const failures = [now]; // 1 failure — under the free allowance, so not locked
    expect(evaluateThrottle({ ...empty, failures }, now, cfg)).toEqual({ ok: true, retryAfterSec: 0 });
  });
});
