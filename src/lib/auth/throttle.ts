import { rateDecision, type RateRule } from "./rate-limit";
import { lockoutGate } from "./lockout";

// AUT-03/04: the throttle decision composes progressive lockout (account
// protection, keyed on the identifier's failures) with sliding-window rate limits
// (abuse protection, per identifier AND per IP). Pure over a timestamp snapshot the
// store supplies, so it stays deterministic and unit-tested; the route converts the
// decision to 429 + Retry-After.

export interface AttemptSnapshot {
  /** All attempt timestamps (ms) for this identifier within the rate window. */
  attempts: number[];
  /** All attempt timestamps (ms) from this IP within the rate window. */
  ipAttempts: number[];
  /** Failed attempt timestamps (ms) for this identifier within the lockout window. */
  failures: number[];
}

export interface ThrottleConfig {
  perIdentifier: RateRule;
  perIp: RateRule;
}

export interface ThrottleDecision {
  ok: boolean;
  retryAfterSec: number;
  reason?: "rate_limited" | "locked_out";
}

export function evaluateThrottle(
  snap: AttemptSnapshot,
  now: number,
  cfg: ThrottleConfig,
): ThrottleDecision {
  // Lockout first: a locked account is refused regardless of rate budget.
  const failCount = snap.failures.length;
  const lastFail = failCount ? Math.max(...snap.failures) : undefined;
  const gate = lockoutGate(failCount, lastFail != null ? now - lastFail : Number.POSITIVE_INFINITY);
  if (gate.locked) {
    return { ok: false, retryAfterSec: Math.ceil(gate.retryAfterMs / 1000), reason: "locked_out" };
  }

  const byId = rateDecision(snap.attempts, now, cfg.perIdentifier);
  const byIp = rateDecision(snap.ipAttempts, now, cfg.perIp);
  if (!byId.allowed || !byIp.allowed) {
    const retryMs = Math.max(byId.retryAfterMs, byIp.retryAfterMs);
    return { ok: false, retryAfterSec: Math.ceil(retryMs / 1000), reason: "rate_limited" };
  }
  return { ok: true, retryAfterSec: 0 };
}

// Default policy (auth is the strictest route class — API-05).
export const LOGIN_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 8, windowMs: 300_000 }, // 8 / 5min per email
  perIp: { limit: 30, windowMs: 300_000 }, // 30 / 5min per IP
};

// Reset requests are rarer and costlier (email) — tighter per identifier.
export const RESET_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 5, windowMs: 900_000 }, // 5 / 15min per email
  perIp: { limit: 20, windowMs: 900_000 }, // 20 / 15min per IP
};
