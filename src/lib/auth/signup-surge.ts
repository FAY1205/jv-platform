import type { RateRule } from "./rate-limit";

// WP-SU-8: the GLOBAL signup dimension, kept pure so it is deterministic and unit-tested —
// the store supplies the count, this decides. Mirrors the rate-limit/throttle split.
//
// The verdict reports a CONDITION (`>=`), not an edge. It stays true for as long as volume
// stays high, so the caller MUST gate the alert through `allowSignupAlert` (notice-budget.ts)
// or it will email admins once per request.
//
// This deliberately replaced an equality-based scheme (`priorCount === threshold`) that tried
// to make each crossing self-limiting. It did not work, and it failed in the worst direction:
// a ceiling-refused request returns 429 before reaching the `record` call inside the route's
// uniform-timing block, so refusals never increment the count. The count froze at exactly the
// ceiling and every later refused request re-alerted — measured at 3 alerts for 3 refused
// requests. Equality also lost the alert entirely when two concurrent requests stepped past
// the exact threshold value. A persistent condition plus an explicit cooldown is correct in
// both directions; the count dynamics are no longer load-bearing.

export interface SurgeVerdict {
  /** Refuse this request — the global hourly ceiling is reached. */
  blocked: boolean;
  /** Non-null while a threshold condition holds. Gate it through a cooldown before sending. */
  alert: string | null;
}

/**
 * @param priorCount signup attempts in the trailing window, NOT counting this request.
 */
export function evaluateSignupSurge(
  priorCount: number,
  ceiling: RateRule,
  surgeThreshold: number,
): SurgeVerdict {
  if (priorCount >= ceiling.limit) {
    return {
      blocked: true,
      alert: `signup ceiling reached: ${priorCount} in the last hour (ceiling ${ceiling.limit}) — new signups are being refused`,
    };
  }
  if (priorCount >= surgeThreshold) {
    return {
      blocked: false,
      alert: `signup surge: ${priorCount} in the last hour (ceiling ${ceiling.limit})`,
    };
  }
  return { blocked: false, alert: null };
}
