// AUT-03 / API-05: sliding-window rate limiting. The store supplies the attempt
// timestamps already recorded for a key; this pure function decides allow/deny and
// the Retry-After. Deterministic and unit-tested; no I/O here.

export interface RateRule {
  limit: number;
  windowMs: number;
}

export interface RateDecision {
  allowed: boolean;
  /** Attempts left in the window AFTER this one (0 when the limit is reached). */
  remaining: number;
  /** When blocked, ms until the oldest in-window attempt exits (else 0). */
  retryAfterMs: number;
}

export function rateDecision(timestampsMs: number[], now: number, rule: RateRule): RateDecision {
  const cutoff = now - rule.windowMs;
  const inWindow = timestampsMs.filter((t) => t > cutoff).sort((a, b) => a - b);
  const count = inWindow.length;

  if (count < rule.limit) {
    return { allowed: true, remaining: Math.max(0, rule.limit - count - 1), retryAfterMs: 0 };
  }
  const oldest = inWindow[0];
  return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, oldest + rule.windowMs - now) };
}
