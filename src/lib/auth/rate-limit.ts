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

/**
 * WP-SU-9: the same decision when the caller's OWN attempt is ALREADY in `timestampsMs`.
 *
 * Reserving before deciding (see AuthAttemptsStore.reserve) is what makes the decision atomic,
 * but it also means the window now contains the request being judged. Feeding that straight to
 * `rateDecision` would silently tighten every configured limit by one — login 8→7, signup 5→4 —
 * because the Nth request sees N rows and is refused when N reaches the limit.
 *
 * Allowing while `count < limit + 1` is exactly `count <= limit`, which admits the configured
 * number of attempts and nothing more. `remaining` and `retryAfterMs` are unaffected: the extra
 * row is always the newest, so the oldest-in-window used for the retry hint is the same one.
 */
export function rateDecisionWithSelf(timestampsMs: number[], now: number, rule: RateRule): RateDecision {
  return rateDecision(timestampsMs, now, { limit: rule.limit + 1, windowMs: rule.windowMs });
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
