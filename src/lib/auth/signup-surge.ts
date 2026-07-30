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
 * @param observed signup attempts in the trailing window, INCLUDING this request.
 *
 * WP-SU-9 contract change: the route now reserves its attempt before counting, which is what
 * closes the ceiling's own CWE-367 race (previously several concurrent requests could each read
 * 59 and all pass). The count therefore includes the request being judged, and the two
 * comparisons differ deliberately:
 *
 *  - REFUSE when admitting this one would EXCEED the ceiling — `observed > limit`. At the 60th
 *    request `observed` is 60, which is the 60th admission, not the 61st; using `>=` here would
 *    admit only 59 and silently tighten the configured ceiling by one.
 *  - WARN when volume has REACHED the surge threshold — `observed >= threshold`, so the alert
 *    fires on the 30th request rather than the 31st.
 */
export function evaluateSignupSurge(
  observed: number,
  ceiling: RateRule,
  surgeThreshold: number,
): SurgeVerdict {
  if (observed > ceiling.limit) {
    return {
      blocked: true,
      alert: `signup ceiling reached: ${observed} in the last hour (ceiling ${ceiling.limit}) — new signups are being refused`,
    };
  }
  if (observed >= surgeThreshold) {
    return {
      blocked: false,
      alert: `signup surge: ${observed} in the last hour (ceiling ${ceiling.limit})`,
    };
  }
  return { blocked: false, alert: null };
}
