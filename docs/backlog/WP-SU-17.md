# WP-SU-17: otp/verify uniform-timing floor (AUT-05)
Spec: AUT-05 (§6.18) · Phase: 2 · Tier: A · Depends: WP-SU-12/15 (otp/verify outcomes), enumeration.withUniformTiming

## Problem (audit-security F-5, deferred from WP-SU-15/16)
`otp/verify` is the only pre-session auth route with NO `withUniformTiming` floor — unlike
`login`, `otp/request`, and `reset/request`. Its response time varies by outcome because the
paths do different amounts of work:
- **no active challenge** → one write (`settle(true)`), returns fast.
- **wrong code** → two writes (`settle(false)` + `incrementAttempt`) [+ a lockout notify/claim at
  the tripping attempt], slower.
- **expired / too_many** → `settle(true)` + `consume`.
- **ok** → `settle(true)` + `establishSessionForEmail` (a Supabase round-trip) + `consume` + user
  lookup + optional trusted-device issue, slowest.

The differing timing is a **low-signal enumeration oracle**: an attacker POSTing a code for an
address can infer from the response time whether a **live OTP challenge exists** for it — i.e.
whether that address is a partner who recently requested a code. Pre-existing (not introduced by
WP-SU-12); LOW severity, but it is the one uniform-timing gap in the auth surface.

## Design — mirror the sibling routes
Wrap the **post-gate** body (everything after the AUT-03 throttle decision) in
`withUniformTiming(MIN_RESPONSE_MS, work, sleep, clock)`, exactly as `login` / `otp/request` /
`reset/request` do. Two shape differences from `otp/request`, both handled:

1. **The response varies by outcome**, so `work` RETURNS the `NextResponse` for each path (rather
   than the route returning one uniform response after). The route returns `work`'s result.
2. **`withUniformTiming` swallows a throw** (catch → `undefined`, then still floors). So on an
   unexpected throw `work` yields `undefined`; the route returns a floored generic `500` fallback.
   Every *expected* outcome (no-challenge / wrong / expired / too_many / session_failed / ok)
   returns its proper `Response` from inside `work` and is floored uniformly.

- `MIN_RESPONSE_MS = 500` (matches `login` + `otp/request`; the OK path's Supabase round-trip is the
  same cost class as login's `signInWithPassword`, so 500 covers every path).
- The **429 rate-limit gate stays BEFORE the floor** (returned early, unfloored) — identical to
  `login`/`otp/request`. A rate-limited caller is not part of the live-challenge oracle.
- Flooring the OK path too (not just failures) is deliberate: success is already distinguishable by
  its 200 + session cookies, so flooring it leaks nothing new and keeps one uniform floor. It adds
  ≤ ~450ms to a successful partner sign-in — the same happy-path cost `login` already accepts.
- Swallowed-error observability parity: `login`/`otp/request`/`reset/request` already lose
  `onRequestError` for work-throws under `withUniformTiming`; `otp/verify` now matches (accepted,
  consistent — the fallback 500 is still returned, floored).

## Definition of done
- [x] `otp/verify`'s post-gate body runs inside `withUniformTiming(500)`; the 429 gate stays before it.
- [x] Every outcome returns its existing status/body (no-challenge 400, wrong 400, expired/too_many
      400, session_failed 500, ok 200 + tosRequired); an unexpected throw → floored, LOGGED 500.
- [x] All side effects (settle / incrementAttempt / consume / notifyLockout+claim / session / trust
      cookie / lastPortalLoginAt) preserved and still inside the floored body.
- [x] Observability preserved: `work` catches its own throws, `logError`s the scrubbed fault, and
      returns a floored 500 — so the swallow (+ lost onRequestError) doesn't cost a trace (F-1).
- [x] TDD: a deterministic WIRING test proves the route wraps its body in `withUniformTiming(500)`
      (red→green), plus 429-before-floor and throw→logged-500 cases.
- [x] Regression: otp/verify suites green (auth-lockout-notify, auth-lockout-decoupling, auth-otp).
- [x] Self-audit (PLAYBOOK §6) printed in the summary. Reviews: pr-reviewer + audit-security folded.
- [ ] Owner walkthrough. No commit until owner go.

## Tests (TDD — names carry AUT-05; integration self-skips without DATABASE_URL) — AS BUILT
A wall-clock assertion was REJECTED: the remote test pooler's per-query latency alone exceeds the
500ms floor (and can exceed it on the multi-write paths), so a wall-clock lower bound can't
distinguish "floored" from "naturally slow" here — whereas in prod (co-located DB) the paths are
tens of ms and the floor is what masks them. The flooring MATH is already unit-proven with an
injected clock (`tests/unit/auth.test.ts` "pads to a uniform minimum time"). So the route test is a
deterministic WIRING test: it mocks `withUniformTiming` to capture the injected `minMs` and run
`work` WITHOUT the real sleep.
- `AUT-05: wraps its post-gate body in withUniformTiming at the sibling-standard 500ms floor` — a
  no-challenge verify → `timing.minMs === [500]` (red before WP-SU-17: the route never called it).
- `AUT-05: a rate-limited verify (429) is refused BEFORE the floor` — fills the OTP rate window →
  429 and `timing.minMs === []` (the gate is unfloored, pre-review-F-2 coverage).
- `AUT-05: an unexpected throw inside the floored body yields a floored otp_verify_failed 500` —
  forces `latestActive` to throw → 500 `otp_verify_failed`, still `timing.minMs === [500]` (covers
  the new fallback + F-1 logging).
- Regression: the existing otp/verify behaviour tests (auth-lockout-notify / auth-lockout-decoupling
  / auth-otp) stay green — each call is now +≤500ms — proving every outcome's status/body/side
  effects are unchanged through the real floor.

## Review findings — folded
- **F-1 (pr-review High / audit-security Low): swallowed infra fault lost observability.** This
  route's `work` body is large (4+ tables + a Supabase session + cookie write), so wrapping it in
  `withUniformTiming`'s bare swallow defeated `onRequestError`→Sentry. **Fixed:** `work` catches its
  own throws, `logError`s the scrubbed message, and returns a floored 500 — trace restored,
  timing/behaviour unchanged.
- **F-2 (pr-review Medium): this doc was stale** (DoD `[ ]`, Tests described the abandoned wall-clock
  approach). Fixed above (as-built).
- **F-3 (pr-review Low): the wiring test drove only the no-challenge branch** — structurally it
  proves the single wrap site, and the throw/429 cases + the behaviour regression suites now
  exercise the other branches through the real floor. Accepted.

## Out of scope
- No change to the outcome logic, the AUT-04 lockout notify/claim (WP-SU-16), or the 429 gate.
- Making the route's `sleep`/`clock` injectable for a deterministic route-level timing test — the
  primitive is already unit-tested with injection; the route uses a wall-clock lower-bound assertion.

## Notes
- Env: build on `claude/wp-su-16`; copy `.env.local` into a fresh worktree or integration tests
  self-skip (false green).
- Before any commit: `git diff --cached --name-only` must NOT include `PRODUCT_BRIEF.md`,
  `WEBSITE-BRIEF.md`, or `docs/legal/`.
