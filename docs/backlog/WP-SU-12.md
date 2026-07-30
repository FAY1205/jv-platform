# WP-SU-12: Auth abuse hardening — decouple code-request from lockout (AUT-04)
Spec: AUT-04 (§6.18) · Phase: 2 · Tier: A · Depends: auth_attempts store, throttle/lockout (WP-SU auth series)

## Problem (verified 2026-07-30 against phase-2/distribution)
`AuthAttemptsStore.snapshot()` builds two independent sets from `auth_attempts`:
- **rate window** (`attempts` / `ipAttempts`) — counts *every* row regardless of `success` → abuse/flood cap (AUT-03).
- **lockout ladder** (`failures`) — counts only `success = false` rows → progressive lock (AUT-04); locks on the **5th** failure, keyed on the **identifier**.

Three endpoints record `record(email, ip, KIND, false)` on **every admitted attempt**, even though they perform **no credential check**:
- `src/app/api/auth/otp/request/route.ts:47`
- `src/app/api/auth/reset/request/route.ts:53`
- `src/app/api/auth/otp/verify/route.ts:51` (records `false` *before* it even checks for an active challenge)

Because otp/request and reset/request require **no credential** (anyone can request a code/reset for any email), a stranger naming a victim's email can post 5 requests and trip the victim's progressive lockout — silently DoS-ing the victim's own sign-in/reset. otp/verify is the same vector: a stranger can post `{email: victim, code: "000000"}` 5× with **no code ever issued** and lock the victim; a legitimate **successful** sign-in also records `false` (self-DoS after 5 sign-ins/hour).

This inverts AUT-04's stated intent ("progressive delays after repeated **failures**"): a *request* for a code is a normal action, not a credential failure. Counting it lets a third party weaponise lockout as a DoS.

**Correct reference already in the codebase:** `src/app/api/auth/login/route.ts` settles `store.settle(attemptId, success === true)` — a wrong password → `false` (feeds lockout, intended); a success → `true` (does not). The three endpoints simply don't follow this pattern.

**Base note (2026-07-30):** this WP was originally drafted against the pre-WP-SU-9 base, where the routes used a one-shot `attempts.record(...)`. WP-SU-9 has since landed the reserve/settle model (each route `reserve()`s a `success:true` row up front, then `settle()`s the real outcome — that is what closes the CWE-367 throttle race). So this WP was **re-implemented on the current reserve/settle base**: the fix changes each route's `settle(...)` value rather than its `record(...)` value. The semantics are identical (only `success:false` rows feed lockout); the mechanism below reads `settle`, not `record`.

## Design (owner-approved 2026-07-30)
Reuse the login route's existing `success` semantic — "was this a genuine credential **failure**?" No schema change, no new column, no migration.

| Endpoint | Today (post-WP-SU-9) | Fix |
|---|---|---|
| otp/request | `settle(attemptId, false)` always | `settle(attemptId, true)` always — a code *request* is not a credential check |
| reset/request | `settle(attemptId, false)` always | `settle(attemptId, true)` always — same |
| otp/verify | `settle(attemptId, false)` once, right after the gate | settle the **actual outcome** at each post-gate exit: `false` **only** when an active challenge exists and the code is genuinely wrong; `true` for success / no-challenge / expired / too-many |

**Why flood protection is unchanged:** `snapshot()`'s `attempts`/`ipAttempts` queries have **no `success` filter**, so flipping `false→true` keeps every row in the rate set and only removes it from the lockout set. Per-identifier and per-IP rate caps (AUT-03) are untouched.

**otp/verify granularity (owner decision):** ONLY a genuinely wrong code (active challenge present + `outcome === "wrong"`) feeds lockout. This preserves AUT-04 brute-force protection on issued codes while making the endpoint un-weaponizable when no code was ever issued.

### Rejected alternatives
- **Explicit `feedsLockout` column / new `kind`** — self-documenting but requires migration + RLS + index (CLAUDE.md schema rule) for zero functional gain.
- **Stop recording in request endpoints** — breaks the AUT-03 rate cap (rate counts the same rows). Regresses flood protection.

## Definition of done
- [x] `otp/request/route.ts` records `success:true` for admitted requests (clear AUT-04 comment on why a request is not a credential failure).
- [x] `reset/request/route.ts` records `success:true` for admitted requests (same comment).
- [x] `otp/verify/route.ts` records the real outcome — `false` only for a genuinely wrong code on an active challenge; `true` otherwise; still exactly one row per admitted attempt (rate window preserved). Throttle-gate 429 continues to record nothing.
- [x] login route left unchanged (it is the correct reference).
- [x] TDD: 5 AUT-04 integration tests, real red→green, ran non-skipped (5/5); regression 23/23 (6 auth suites).
- [x] Self-audit checklist (PLAYBOOK §6) printed in the summary.
- [x] Reviews: pr-reviewer (GO) + audit-security (SAFE) — no blocking findings.
- [ ] Owner walkthrough. No commit until owner go.

## Tests (TDD — names carry AUT-04; integration self-skips without DATABASE_URL)
- `AUT-04: repeated OTP requests by a stranger never lock the victim` — post otp/request 5× for an email → `snapshot.failures.length === 0`, `evaluateThrottle(...).reason !== "locked_out"`.
- `AUT-04: repeated reset requests by a stranger never lock the victim` — same for reset/request.
- `AUT-04: OTP/reset requests still count toward the rate window` — after N requests, `snapshot.attempts.length === N` (flood cap intact).
- `AUT-04: a verify with no active challenge does not feed lockout` — post otp/verify 5× with no issued code → `failures.length === 0`.
- `AUT-04: a genuinely wrong OTP code still feeds lockout` — issue a real challenge, submit 5 wrong codes → lockout trips (proves no over-correction; brute-force protection preserved).
- Red first (assert against current `false` behaviour), then green.

## Out of scope (→ WP candidates, not built here)
- OTP/reset have **no `notifyLockout` owner-email** like login's `login/route.ts:69` — an AUT-04 notification gap; own WP.
- Audit signup's lockout coupling for the same class of issue.

## Notes / risks
- Land on `claude/focused-lalande-45ec27` (this worktree), then PR into `phase-2/distribution` (auth files are byte-identical across the two branches). Owner-approved.
- **Env:** this worktree has no `.env.local` → integration tests silently self-skip (false-green). Run where `DATABASE_URL` is set and read the pass/skip counts.
- Before any commit: `git diff --cached --name-only` must NOT include `PRODUCT_BRIEF.md`, `WEBSITE-BRIEF.md`, or `docs/legal/`.
