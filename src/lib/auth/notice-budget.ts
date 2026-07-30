import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";
import { AuthAttemptsStore } from "./attempts-store";
import type { RateRule } from "./rate-limit";
import { ALREADY_REGISTERED_CAP, SIGNUP_ALERT_COOLDOWN } from "./throttle";
import { logError } from "@/lib/observability";

// WP-SU-8: "at most N per window" budgets for OUTBOUND notifications, counted in
// auth_attempts under synthetic kinds. Two callers, same shape, one implementation — the
// alternative was two near-identical read-then-write helpers, and restating one rule in two
// places has drifted inside a single commit in this repo before.
//
// Every row is written `success: true`. `auth_attempts.success` is dual-purpose: all rows
// feed a rate window, but only `false` rows feed the AUT-04 progressive lockout ladder. A
// notification budget must never be able to lock an account — otherwise a stranger could
// lock a victim just by naming their address at signup.

type Db = PostgresJsDatabase<typeof schema>;

const NOTICE_KIND = "signup_notice";
const ALERT_KIND = "signup_alert";

/**
 * The alert cooldown is keyed PER THRESHOLD, not globally. A single shared key would let a
 * surge alert consume the hour's budget and then silently swallow the ceiling alert that
 * follows it — suppressing the escalation ("signups are now being refused") in favour of the
 * warning that preceded it, which is exactly backwards.
 */
export type SignupAlertKey = "surge" | "ceiling";

/**
 * Consume one unit of a budget. Returns false when it is exhausted.
 *
 * ACCEPTED RACE (CWE-367), documented rather than fixed: this reads then writes with no
 * reservation, so concurrent requests can each pass before any of their writes commit. Both
 * call sites are bounded from above by a throttle that runs earlier in the same request —
 * for the notice cap that is the per-identifier signup limit (5/15min on the same address),
 * so the worst case is ~5 notices where 3 were intended, and for the alert cap it is the
 * same limit plus the fact that an alert only fires above the surge threshold at all. The
 * consequence in both cases is one or two extra emails, never unbounded, so closing it would
 * duplicate WP-SU-9's reserve/settle mechanism for a low-value target. Revisit if either
 * notification ever becomes expensive.
 */
async function consumeBudget(
  db: Db,
  kind: string,
  key: string,
  rule: RateRule,
  now: number,
  exhaustedCode: string,
  failedCode: string,
): Promise<boolean> {
  try {
    const attempts = new AuthAttemptsStore(db);
    const used = await attempts.identifierCount(key, kind, now, rule.windowMs);
    if (used >= rule.limit) {
      // SEC-05: the code and nothing else — a recipient address is user PII, and this line
      // reaches both the console and Sentry.
      logError(exhaustedCode);
      return false;
    }
    await attempts.record(key, null, kind, true);
    return true;
  } catch (e) {
    // SEC-05, load-bearing: both callers run inside Next's `after()`, and an escaping throw
    // there is `console.error`d RAW by the framework's after-context — outside logError's
    // scrub seam (the one gap WP-SU-3 could not close). A failed Drizzle query embeds every
    // bound parameter, and the bound parameter here is the recipient's email address. So a
    // transient pooler blip during a signup naming a real user would print that address in
    // clear to the host log store. Catch it here and route it through the seam.
    //
    // Fail CLOSED (no send): the notification is a courtesy, the budget is a safety property.
    logError(failedCode, { message: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/**
 * WP-SU-8: per-recipient cap on the victim-directed "you already have an account" mail.
 *
 * This mail goes to a third party the requester merely NAMED — the attacker supplies someone
 * else's address and that person receives the mail. The per-identifier signup throttle is
 * keyed on that same address, so it caps the attacker at 5/15min ≈ 480 mails/day into a
 * stranger's inbox. This is the cap that closes that.
 */
export function allowAlreadyRegisteredMail(db: Db, email: string, now: number): Promise<boolean> {
  return consumeBudget(
    db,
    NOTICE_KIND,
    email,
    ALREADY_REGISTERED_CAP,
    now,
    "already_registered_mail_capped",
    "already_registered_cap_failed",
  );
}

/**
 * WP-SU-8: at most one signup surge/ceiling alert per hour, per threshold.
 *
 * This is what makes the alert correct, and it replaced a much more fragile scheme. The
 * first version fired the alert only when the hourly count was EXACTLY equal to a threshold,
 * on the theory that each crossing would then produce one email. That is true for the surge
 * threshold, but it was WRONG for the ceiling, and backwards from the intended direction: a
 * ceiling-refused request returns 429 before reaching the `record` call inside the
 * uniform-timing block, so a refused request never increments the count. The count therefore
 * FROZE at exactly the ceiling and every subsequent refused request re-alerted — an
 * unbounded inbox flood on precisely the path the alert exists for. (Measured: 3 refused
 * requests produced 3 alerts.)
 *
 * Capping the alert itself instead lets the verdict use `>=`, which also closes the opposite
 * failure the equality scheme had — two concurrent requests stepping past the exact
 * threshold value and losing the alert entirely.
 */
export function allowSignupAlert(db: Db, key: SignupAlertKey, now: number): Promise<boolean> {
  return consumeBudget(
    db,
    ALERT_KIND,
    key,
    SIGNUP_ALERT_COOLDOWN,
    now,
    "signup_alert_suppressed_duplicate",
    "signup_alert_cooldown_failed",
  );
}
