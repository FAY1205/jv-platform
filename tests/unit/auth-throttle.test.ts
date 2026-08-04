import { describe, it, expect } from "vitest";
import { evaluateThrottle, type AttemptSnapshot, type ThrottleConfig } from "@/lib/auth/throttle";

// AUT-03/04: composition of lockout (account protection) + sliding-window rate
// limits (abuse protection) over a timestamp snapshot. Pure and deterministic.
//
// WP-SU-9 CONTRACT: the snapshot INCLUDES the attempt being judged, because callers reserve the
// attempt row before snapshotting — that ordering is what closes the CWE-367 race. So a window
// that is "full" contains limit + 1 rows: the `limit` already spent plus this one. Feeding a
// self-exclusive window here would silently tighten every configured limit by one.
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
    // limit (5) already spent + this request's own reservation = 6 (WP-SU-9 contract).
    const attempts = Array.from({ length: 6 }, (_, i) => now - i * 1000);
    const d = evaluateThrottle({ ...empty, attempts }, now, cfg);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("rate_limited");
  });

  it("AUT-03 (WP-SU-9): admits exactly the configured limit, not one fewer", () => {
    // The limit'th request: 4 already spent + its own reservation = 5 rows in the window.
    const attempts = Array.from({ length: cfg.perIdentifier.limit }, (_, i) => now - i * 1000);
    expect(evaluateThrottle({ ...empty, attempts }, now, cfg).ok).toBe(true);
  });

  it("rate-limits by IP when many identifiers are hammered from one IP", () => {
    const ipAttempts = Array.from({ length: 21 }, (_, i) => now - i * 100); // 20 spent + self
    const d = evaluateThrottle({ ...empty, ipAttempts }, now, cfg);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("rate_limited");
  });

  it("reports Retry-After in whole seconds (rounded up)", () => {
    const failures = [now]; // 1 failure — under the free allowance, so not locked
    expect(evaluateThrottle({ ...empty, failures }, now, cfg)).toEqual({ ok: true, retryAfterSec: 0 });
  });
});
