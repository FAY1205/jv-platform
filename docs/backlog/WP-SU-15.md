# WP-SU-15: AUT-04 lockout notification for OTP (owner email on OTP lockout)
Spec: AUT-04 (§6.18) · Phase: 2 · Tier: A · Depends: WP-SU-12 (OTP/reset lockout decoupling, integrated at 77e3b5e), auth_attempts store, throttle/lockout

## Problem (verified 2026-07-30 against phase-2/distribution @ 77e3b5e)
AUT-04 (§6.18) requires: *"the account owner is notified by email on lockout."* The admin
password route does this — `src/app/api/auth/login/route.ts:76` fires `notifyLockout(email)`
exactly at the lockout-tripping failure. The partner OTP route does **not**:
`src/app/api/auth/otp/verify/route.ts` *enforces* the lockout (`evaluateThrottle`'s
`lockoutGate` refuses once the identifier has 5 `success:false` rows) but never notifies —
so an OTP lockout is **silent**. The victim is locked out of sign-in with no alert.

**WP-SU-12 makes this matter more, not less.** Before it, otp/verify settled `success:false`
on *every* admitted verify, so an OTP lockout could be spurious (a stranger with no issued
code, or the victim's own successful sign-ins). Post-WP-SU-12, `otp/verify` settles `false`
**only** on a genuinely wrong code against an active challenge (`route.ts:73`,
`outcome !== "wrong"` is the success flag). So every OTP lockout now corresponds to real
repeated wrong-code failures — exactly the AUT-04 "repeated failures" case that must notify —
yet none do. This is a partner sign-in DoS with no alert to the victim.

## Reset endpoints — checked, correctly out of scope (verified against @ 77e3b5e)
- **reset/request** (`route.ts:61`): settles `success:true` (WP-SU-12) — a reset *request* is
  not a credential failure, so it never feeds the AUT-04 lockout ladder. No lockout, nothing
  to notify.
- **reset/confirm** (`route.ts`): throttled by `RESET_CONFIRM_THROTTLE` via `rateDecisionWithSelf`
  — a **sliding-window rate cap ONLY**, deliberately **not** `evaluateThrottle`/`lockoutGate`
  (throttle.ts:91–99, WP-SU-9). It never composes the AUT-04 progressive-lockout ladder (the
  ladder's escape hatches — owner notify + admin `clearFailures` — are unreachable for a
  token-derived key that lives only in the user's inbox). There is therefore **no lockout
  event** on reset/confirm to notify about. Correctly untouched.
- **otp/request** (`route.ts:55`): settles `success:true` (WP-SU-12) — same as reset/request,
  never feeds lockout.
- **login**: already correct — the reference implementation. Untouched.

**Net:** the only endpoint that both enforces the AUT-04 lockout AND fails to notify is
`otp/verify`. WP-SU-15 is a one-endpoint change.

## Design (mirror the login reference)
In `otp/verify`'s genuine-wrong-code branch, after the `settle(false)` + `incrementAttempt`,
add the exact idiom login uses:

```ts
if (lockoutState(snap.failures.length + 1).shouldNotify) await notifyLockout(email);
```

**Why `snap.failures.length + 1` is correct here (same as login):** `reserve()` writes the
attempt row `success:true` (attempts-store.ts:43), so it is invisible to `snapshot()`'s
`failures` query (which counts only `success:false`). The `snap` is taken at `route.ts:54`,
*before* the `settle(attemptId, false)` at `route.ts:73` flips this row to a failure.
So `snap.failures` is the PRE-settle count of prior failures, and `+ 1` counts the failure
being settled now — identical to `login/route.ts:76` (snapshot taken before `settle`).
`lockoutState(...).shouldNotify` is true exactly at the first lockout (`over === 1`, i.e. the
5th failure with `FREE_ATTEMPTS = 4`) — the same predicate that gates enforcement, so the
notice fires on the same failure that first trips the lock.

**Why it never over-fires:** only `outcome === "wrong"` reaches this branch (WP-SU-12). A
credential-less verify (no challenge / expired / too_many) and a correct code all settle
`true` and never enter it — so the owner is never emailed on a stranger's no-code attempts
or on a legitimate sign-in.

`notifyLockout` is best-effort (its own try/catch, notify.ts) and never blocks the response,
matching login.

## Definition of done
- [ ] `otp/verify` emails the account owner (`notifyLockout(email)`) exactly at the
      lockout-tripping wrong code, using login's `lockoutState(snap.failures.length + 1)`
      predicate; only in the `outcome === "wrong"` branch.
- [ ] reset/confirm, reset/request, otp/request, login left unchanged (documented above).
- [ ] TDD: AUT-04 integration tests, real red→green, ran non-skipped (read pass/skip counts).
- [ ] Regression: auth suites green.
- [ ] Self-audit checklist (PLAYBOOK §6) printed in the summary.
- [ ] Reviews: pr-reviewer + audit-security — no blocking findings.
- [ ] Owner walkthrough. No commit until owner go.

## Tests (TDD — names carry AUT-04; integration self-skips without DATABASE_URL)
- `AUT-04: a wrong OTP code emails the owner exactly at the lockout-tripping 5th attempt, not
  before` — issue a real challenge; wrong code ×4 → 0 lockout emails; 5th wrong code → exactly
  1 lockout email to the victim; 6th request (gated 429) → still exactly 1 (no re-notify).
- `AUT-04: a verify with no active challenge never emails a lockout notice` — 6× wrong verify
  with no issued code → 0 lockout emails (proves it never fires on a non-wrong outcome, and
  the stranger-DoS victim is never spammed either).
- Red first (assert the 5th-attempt email against the current no-notify behaviour), then green.

## Out of scope (→ WP candidates, not built here)
- **F-2 (audit-security): `otp/verify` has no `withUniformTiming` floor** — unlike
  login/otp-request/reset-request. Its per-outcome DB-write count differs (no-challenge = 1
  write, wrong = 2), a low-signal "is there a live challenge / is this a partner" timing
  oracle. Pre-existing (not introduced by WP-SU-12). Owner decision: **defer** to its own WP;
  keep WP-SU-15 focused on the AUT-04 notification.
- Audit signup's lockout notification coupling for the same class of gap.

## Notes / risks
- **Env:** a fresh worktree has no `.env.local` → integration tests silently self-skip
  (false-green). Copy `.env.local` in first and read the pass/skip counts.
- Observability of the notification in tests uses the SEC-07 dev mailbox
  (`recentDevEmails` / `clearDevMailbox`): non-prod mail is captured by `DevMailboxTransport`,
  so the REAL `notifyLockout` path is exercised (no notify mock).
- Before any commit: `git diff --cached --name-only` must NOT include `PRODUCT_BRIEF.md`,
  `WEBSITE-BRIEF.md`, or `docs/legal/`.
