import { lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { AuthAttemptsStore, LOCKOUT_WINDOW_MS } from "./attempts-store";
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

export const NOTICE_KIND = "signup_notice";
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

/**
 * The auth surface a lockout notice belongs to. The password-login and partner-OTP surfaces are
 * SEPARATE lockout events for the same email (they key on different `auth_attempts.kind` and each
 * runs its own AUT-04 ladder), so their notices must NOT share a claim key — a lock on one surface
 * must never suppress the owner alert for a genuine lock on the other. This is exactly the
 * pre-WP-SU-16 behaviour (two independent `shouldNotify` decisions); WP-SU-16 de-dups only the
 * concurrent burst WITHIN one surface, never across surfaces.
 */
export type LockoutSurface = "login" | "otp";
const lockoutNoticeKind = (surface: LockoutSurface): string => `lockout:${surface}`;

/**
 * One lockout notice per (identifier, surface) per window. Reuses the AUT-04 lockout look-back (1h,
 * the full exponential-escalation cap), so a genuinely NEW lock event — one that trips after the
 * previous notice has aged past the window — notifies again, while every racing request inside one
 * event collapses to a single mail.
 */
export const LOCKOUT_NOTICE_WINDOW_MS = LOCKOUT_WINDOW_MS;

/**
 * WP-SU-16: atomically claim the single lockout notice for (`email`, `surface`) in the current
 * window. Returns true for EXACTLY ONE caller per (identifier, surface, window), even under a
 * concurrent burst of wrong-credential requests — the guarantee the read-then-write `consumeBudget`
 * above deliberately does NOT make (CWE-367, documented there). It is required because BOTH
 * lockout-notify call sites (login, otp/verify) decide from a PRE-settle snapshot, so N racing
 * requests each read the same `failures.length` and each believe they are the tripping attempt;
 * without a single winner they each email the victim. `surface` keeps the two auth surfaces'
 * notices independent (see LockoutSurface) — it is NOT a cross-surface merge.
 *
 * Mechanism: `INSERT … ON CONFLICT (identifier,kind) DO UPDATE SET notified_at = now WHERE the
 * stored notice is older than the window, RETURNING`. Postgres row-locks the (identifier, kind)
 * unique-constraint conflict (the arbiter — since WP-SU-18 that key is a UNIQUE index, not the PK,
 * which is now a surrogate uuid `id`), so of N racers exactly one still sees `notified_at` older
 * than the cutoff and gets a row back
 * (a win); the rest re-evaluate the `WHERE` against the just-written value (≈ now) and get nothing.
 * A first-ever key inserts, which is also a win. One row per key, updated in place — no per-event growth.
 */
export async function claimLockoutNotice(
  db: Db,
  email: string,
  surface: LockoutSurface,
  now: number,
): Promise<boolean> {
  const notifiedAt = new Date(now);
  const cutoff = new Date(now - LOCKOUT_NOTICE_WINDOW_MS);
  try {
    const won = await db
      .insert(schema.noticeClaims)
      .values({ identifier: email.toLowerCase(), kind: lockoutNoticeKind(surface), notifiedAt })
      .onConflictDoUpdate({
        target: [schema.noticeClaims.identifier, schema.noticeClaims.kind],
        set: { notifiedAt },
        // Typed comparison (not a raw `sql` template): drizzle applies the column's timestamptz
        // codec to `cutoff`, exactly as attempts-store's gt() does. A raw template would hand
        // postgres-js an un-coded Date (locale string) that Postgres rejects as invalid timestamptz.
        setWhere: lt(schema.noticeClaims.notifiedAt, cutoff),
      })
      .returning({ identifier: schema.noticeClaims.identifier });
    return won.length > 0;
  } catch (e) {
    // Fail OPEN (send). Unlike consumeBudget (a courtesy-mail throttle, fail-closed), this claim
    // gates a SECURITY alert — "your account was just locked." A silently dropped alert leaves the
    // victim unaware their account is under attack, which is worse than a rare duplicate mail. So on
    // a claim-query error we let the notify proceed. This does NOT reopen the flood the claim exists
    // to prevent: that needs N racers to ALL error simultaneously, which happens only under genuine
    // DB degradation (transient, operational) and is never attacker-controllable — the claim errors
    // on infra faults, not on request input — and notifyLockout is itself best-effort. SEC-05: a
    // failed Drizzle query embeds its bound parameters, one of which is the recipient email — route
    // it through the scrub seam, never let it escape raw (same guard as consumeBudget above).
    logError("lockout_notice_claim_failed", { message: e instanceof Error ? e.message : String(e) });
    return true;
  }
}
