import { rateDecisionWithSelf, type RateRule } from "./rate-limit";
import { lockoutGate } from "./lockout";

// AUT-03/04: the throttle decision composes progressive lockout (account
// protection, keyed on the identifier's failures) with sliding-window rate limits
// (abuse protection, per identifier AND per IP). Pure over a timestamp snapshot the
// store supplies, so it stays deterministic and unit-tested; the route converts the
// decision to 429 + Retry-After.
//
// WP-SU-9 CONTRACT CHANGE: `snap` now INCLUDES the attempt being judged. Callers reserve the
// attempt row first and only then snapshot, which is what closes the CWE-367 race (N concurrent
// requests used to read the same pre-burst window and all pass — measured 10 of 10 admitted
// against a limit of 3). The rate comparison therefore uses rateDecisionWithSelf. Lockout is
// unaffected: a reservation is written success:true, so it is invisible to the failure ladder
// until the route settles a real failure.

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

  // WP-SU-9: `snap` INCLUDES the current attempt — every caller reserves before deciding, which
  // is what makes the decision atomic (see AuthAttemptsStore.reserve). Hence *WithSelf, or the
  // configured limits would all quietly drop by one.
  const byId = rateDecisionWithSelf(snap.attempts, now, cfg.perIdentifier);
  const byIp = rateDecisionWithSelf(snap.ipAttempts, now, cfg.perIp);
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

// Partner OTP request/verify — code requests capped per email + IP (PTL-01/AUT-03).
export const OTP_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 6, windowMs: 900_000 }, // 6 / 15min per email
  perIp: { limit: 30, windowMs: 900_000 }, // 30 / 15min per IP
};

// Signup email-verification (WP-SU-6, AUT-03). Token entropy already makes guessing
// infeasible, so this is a load cap and a consistency fix — it was the one credential
// endpoint with no throttle kind. The identifier is a truncated hash of the presented
// token (never the token itself — SEC-05), which bounds retries of the SAME link; the
// per-IP limit is what bounds guessing across different tokens, so it is the looser of
// the two by design.
export const VERIFY_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 10, windowMs: 900_000 }, // 10 / 15min per token
  perIp: { limit: 20, windowMs: 900_000 }, // 20 / 15min per IP
};

// Reset completion (WP-SU-9, AUT-03) — the last credential endpoint without a throttle.
// Same shape and reasoning as VERIFY_THROTTLE: the identifier is a truncated hash of the
// presented token (never the token — SEC-05), which bounds replays of ONE link; the per-IP limit
// is what bounds guessing across different tokens. Unthrottled, each guess bought a token
// lookup, an HIBP range fetch, a Supabase password write and a global sign-out.
export const RESET_CONFIRM_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 10, windowMs: 900_000 }, // 10 / 15min per token
  perIp: { limit: 20, windowMs: 900_000 }, // 20 / 15min per IP
};

// WP-SU-22 (AUT-03, audit R-30): change-password was the one credential endpoint with no
// throttle — a session-holder (or a stolen session cookie) could brute-force the CURRENT
// password unmetered, each guess buying a Supabase re-auth. Keyed on the caller's own email
// + IP. Sliding-window ONLY at the call site (like RESET_CONFIRM): the caller is already
// authenticated, so composing AUT-04's progressive account lockout would let a session-
// hijacker lock the real owner out of changing their own password. Same shape as RESET.
export const CHANGE_PASSWORD_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 5, windowMs: 900_000 }, // 5 / 15min per email
  perIp: { limit: 20, windowMs: 900_000 }, // 20 / 15min per IP
};

// Public signup (ADR-0034) — rarer and costlier (provisioning + email) than login,
// same shape/values as RESET_THROTTLE.
export const SIGNUP_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 5, windowMs: 900_000 }, // 5 / 15min per email
  perIp: { limit: 20, windowMs: 900_000 }, // 20 / 15min per IP
};

// WP-B: resend a signup verification email. Tighter per-email than SIGNUP itself — a legit
// user needs at most a couple of resends, and the endpoint is enumeration-safe, so the limit
// only caps how often one address (or IP) can trigger an outbound email. Sliding-window ONLY at
// the call site (like VERIFY): the key is an email, but lockout's escape hatches don't fit a
// pre-auth "resend my own link" action, and a lockout would strand the very user it should help.
export const SIGNUP_RESEND_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 4, windowMs: 900_000 }, // 4 / 15min per email
  perIp: { limit: 20, windowMs: 900_000 }, // 20 / 15min per IP
};

// WP-SU-14 (AUT-10 growth bound): /api/auth/trust/refresh inserts a trusted_devices row per
// SUCCESSFUL rotation and was the one insert-per-call auth endpoint with no throttle (audit-data
// F-1). The growth vector is chain-rotation — each call presents the LATEST token — so the key is
// the FAMILY (stable across the chain), not the per-call token, plus per-IP defence-in-depth.
// Wired sliding-window-ONLY at the call site (like RESET_CONFIRM/VERIFY): AUT-04 lockout's escape
// hatches (owner notify, admin clearFailures) don't apply to a non-inbox key, and lockout would turn
// a benign "please sign in again" into a wait that never fixes it. Limits sit far above any real
// device's rotation cadence (a few/day) and far below an insert-flood.
export const TRUST_REFRESH_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 10, windowMs: 900_000 }, // 10 rotations / 15min per family
  perIp: { limit: 30, windowMs: 900_000 }, // 30 / 15min per IP
};

// WP-SU-8: a GLOBAL rolling-hour ceiling across every identifier and IP. Both keys above
// are attacker-chosen — a fresh email defeats perIdentifier, a rotated IP defeats perIp —
// so without this, distributed signup abuse is bounded by Turnstile alone.
//
// TRADE-OFF, deliberate (ADR-0034): a global ceiling is by construction a small
// availability lever — an attacker who burns the hour's budget also refuses honest
// signups. Every global ceiling has this shape. It is accepted here because the limit sits
// ~100x above expected volume (single digits per DAY), the alert fires at half of it, and
// the alternative is unbounded tenant provisioning + outbound mail.
//
// ACCEPTED RESIDUAL (CWE-367): the route reads this count, decides, then records later, so
// under concurrency the effective ceiling is "60 plus in-flight" rather than a hard 60 —
// several requests can each read 59 and all pass. Bounded by genuine concurrency. WP-SU-9
// closes it generally by reserving the attempt before the decision.
export const SIGNUP_GLOBAL_CEILING: RateRule = { limit: 60, windowMs: 3_600_000 };

/** Alert at half the ceiling, so a surge is visible well before signups start failing. */
export const SIGNUP_SURGE_THRESHOLD = 30;

/**
 * Retry-After for a ceiling refusal. Flat, not computed: a count-only check has no
 * timestamps to drain-time from, and fetching the oldest one to compute an exact value
 * would leak global signup volume through a response header.
 */
export const SIGNUP_CEILING_RETRY_SEC = 300;

/**
 * WP-SU-8: per-recipient cap on the victim-directed "you already have an account" mail.
 * Without it, the per-identifier signup limit (5/15min) lets an attacker mail-bomb a known
 * address ~480x/day using the victim's own address as the key.
 */
export const ALREADY_REGISTERED_CAP: RateRule = { limit: 3, windowMs: 86_400_000 }; // 3 / 24h

/**
 * WP-SU-8: suppresses repeat surge/ceiling alert emails while a threshold condition PERSISTS.
 *
 * Load-bearing, not a nicety. `evaluateSignupSurge` reports a `>=` condition, which stays
 * true for as long as the volume stays high, so without this cooldown a sustained refusal
 * burst would email the whole ADMIN_ALLOWLIST once per refused request. Keyed per threshold
 * (see SignupAlertKey) so a surge alert cannot swallow the ceiling alert that escalates it.
 */
export const SIGNUP_ALERT_COOLDOWN: RateRule = { limit: 1, windowMs: 3_600_000 }; // 1 / hour per key
