# WP-SU-20: login tolerates auth-backend outages (AUT-04 / AUT-05)
Spec: AUT-04 (§6.18, progressive lockout) · AUT-05 (§6.18, uniform response) · Phase: 2 · Tier: A · Depends: WP-SU-9 (reserve/settle), WP-SU-19 (login infra-fault capture)

## Problem (verified 2026-07-31 against phase-2/distribution @ 936a09b)
In `src/app/api/auth/login/route.ts`, the sign-in attempt runs inside `withUniformTiming`, which
swallows any throw into the timing floor and returns `undefined`. `success` is therefore tri-state —
`true` (signed in), `false` (wrong password), or `undefined` (**`signInWithPassword` threw** — a
Supabase/transport/infra fault). The route treated `undefined` **identically to `false`**:
`store.settle(attemptId, success === true)` recorded it as a credential failure that **feeds the
AUT-04 lockout ladder**, and `loginOutcome(false)` returned **401 "Invalid email or password."**

Consequences during a transient auth-backend outage:
1. **Self-inflicted lockout (the real bug):** an admin who retries ~5× during the outage trips their
   OWN AUT-04 lockout — locked out despite never entering a wrong password. A transient outage becomes
   a persistent lockout, exactly when recovery matters.
2. **Misleading response:** the user is told "invalid credentials" when the service is down, so they
   chase a password reset instead of retrying.

WP-SU-19 made this fault *visible* (`login_infra_failed` logged); this WP makes login *tolerate* it.

## Design — handle the three states distinctly (login only)
- `success === undefined` (threw) → **do NOT feed the lockout ladder, return a floored 500** instead
  of 401. The reservation (written before the attempt, WP-SU-9) already stands as a `success:true`
  row — it counts toward the AUT-03 **rate** window but never the AUT-04 lockout ladder — so we
  deliberately **skip the re-`settle`** (a second DB write would likely also fail mid-outage) and skip
  the lockout-notify + IP-anomaly branch entirely. The thrown error is captured in an outer
  `infraError` and returned via `jsonServerError("login_unavailable", …, { message })`, which logs the
  PII-scrubbed fault **and** returns the 500 sharing one `traceId` (F-42). This **supersedes**
  WP-SU-19's inner `logError("login_infra_failed")` on this path (its `catch` becomes capture-and-
  rethrow).
- `false` (wrong password) → **unchanged**: settle false → feeds lockout, 401.
- `true` → **unchanged**: settle true, 200.

**AUT-05-safe:** login's throw is account-independent — `signInWithPassword` throws on transport/infra
faults regardless of whether the email maps to an account — so a distinct 500 status does NOT leak
account existence. (Contrast otp/request/reset/request, where the send only runs for a real account, so
they must stay log-only per WP-SU-19.) Timing stays floored: the 500 returns after `withUniformTiming`.

**Response code:** `500` via `jsonServerError`, matching the repo's existing unexpected-fault
convention (every other 500-catch uses it), rather than introducing a `503`.

**Scope:** login only. `otp/request` and `reset/request` keep WP-SU-19's log-only behaviour untouched.

## Definition of done
- [x] login distinguishes `undefined` (infra fault) from `false` (wrong password): infra → floored
      500, not settled as a failure, no lockout-notify/anomaly; wrong password → 401 + feeds lockout
      (unchanged); success → 200 (unchanged).
- [x] Infra fault logged via `jsonServerError` (`login_unavailable`) — PII-scrubbed detail sharing the
      response traceId (F-42). WP-SU-19's inner `logError("login_infra_failed")` on this path removed
      (superseded); `logError` import dropped from login (now unused).
- [x] TDD: real red→green — the "infra → 500, not settled" test fails against the pre-WP-SU-20 login
      (returns 401), passes after; wrong-password and success guards unchanged.
- [x] No schema change, no new dependency, no ADR (reuses jsonServerError/AUT-04 wiring).
- [x] Regression: `login-lockout-notify` (real login, wrong-password lockout) green isolated —
      credential-failure path unaffected.
- [x] Reviews: pr-reviewer + audit-security — findings folded or documented.
- [ ] Owner walkthrough. No commit until owner go; no push until owner go.

## Tests (TDD — names carry WP-SU-20/AUT-04; fully mocked, no DB, pooler-free)
Extends `tests/unit/auth-route-observability.test.ts` (the WP-SU-19 file):
- infra fault in login → `500` (was 401), `logError("login_unavailable", { message }, <traceId>)`,
  and `settle` NOT called (reservation stands; lockout not fed).
- wrong password → `401` AND `settle(attemptId, false)` (feeds lockout) AND `logError` NOT called.
- success → `200`, `logError` NOT called.
- otp/request & reset/request infra + happy paths: unchanged from WP-SU-19.

## Out of scope (unchanged from WP-SU-19)
- `otp/request` / `reset/request` cannot return a distinct status on a send-failure without leaking
  account existence — they stay log-only.
- A `503 Service Unavailable` + `Retry-After` (more semantically precise than 500) — deferred; 500
  matches the repo convention.

## Notes / risks
- Land on `claude/wp-su-20` (worktree off 936a09b), then fast-forward into `phase-2/distribution`.
- Before any commit: `git diff --cached --name-only` must NOT include `PRODUCT_BRIEF.md`,
  `WEBSITE-BRIEF.md`, or `docs/legal/`.
