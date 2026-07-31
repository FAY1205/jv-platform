# WP-SU-16: lockout-notify de-dup (AUT-04) — atomic single-winner claim
Spec: AUT-04 (§6.18) · Phase: 2 · Tier: A · Depends: WP-SU-15 (OTP lockout notify, 5c0f1c6), WP-SU-9 (reserve/settle), notice-budget (WP-SU-8)

## Problem (verified 2026-07-31 against phase-2/distribution @ 5c0f1c6)
Both lockout-notify call sites decide whether to email the account owner from a **pre-settle
snapshot**:

- `src/app/api/auth/login/route.ts:76` — `if (lockoutState(snapshot.failures.length + 1).shouldNotify) await notifyLockout(email)`
- `src/app/api/auth/otp/verify/route.ts:83` — the same idiom, added by WP-SU-15.

`snapshot`/`snap` is taken *before* the current attempt's `settle(false)` writes its failure row,
so `failures.length + 1` counts "this failure". That is correct for a **serial** caller, and
serially the owner already receives **exactly one** email per lockout event:
- The predicate is true only on the single tripping attempt (`lockout.ts:22`, `over === 1`, the
  5th failure with `FREE_ATTEMPTS = 4`).
- Attempt 6+ is refused at the lockout gate (429) *before* reaching the notify code, and once the
  lock lifts a later failure has `over === 2` → `shouldNotify === false`.

**So there is no serial duplicate path. The defect is concurrency-only.** N simultaneous
wrong-code requests for the same victim each read `snapshot.failures.length === 4` (none has
settled yet), each compute `shouldNotify === true`, and each send — the victim gets 2+ identical
"your account was temporarily locked" emails for one trip event (CWE-367 TOCTOU on the notify
decision).

Scope: LOW severity. The lockout **enforcement** is correct and atomic (WP-SU-9 reserve/settle);
only the notification *count* is affected. No security/PII issue — an email-spam nicety.

## Why the reviewers' suggested fix does not close it
Both reviewers (pr-reviewer + audit-security) suggested reusing the WP-SU-8 notice-budget
primitive (`consumeBudget`) as a per-recipient cap. That primitive is deliberately **read-then-
write with no reservation** and documents its own accepted concurrency race (`notice-budget.ts`
lines 34–42): under a true burst every caller reads the same `identifierCount() === 0`, all
record, all send. Gating the lockout email behind it therefore provides **zero** protection
against the exact (concurrent) bug here, and it cannot back a non-flaky "exactly one email under a
`Promise.all` burst" test. The de-dup it *would* add (sequential repeats) does not exist on this
path (the 429 gate + `over === 1` already handle it). So the cap must be **atomic**, not a budget
count.

## Design — atomic single-winner claim
A tiny claim table + one atomic upsert makes exactly one concurrent caller "win" the notice.

1. **`notice_claims` table** (migration 0028 + RLS deny-by-default, mirroring `auth_attempts`):
   - `identifier text` (lowercased email), `kind text`, `notified_at timestamptz not null`,
     **PRIMARY KEY (identifier, kind)**.
   - One row per (identifier, kind), **reused in place** — no unbounded growth, so no retention
     sweep is required (unlike the append-only `auth_attempts`).
   - NOT tenant-scoped: login runs pre-tenant and keys on the email, exactly like `auth_attempts`.
     Server-managed (service role); RLS is deny-by-default (no permissive policy), so any
     non-service access is refused (SEC-01).

2. **`claimLockoutNotice(db, email, now)`** in `src/lib/auth/notice-budget.ts` (same module as the
   signup budgets — the mechanism is shared, not restated):
   ```sql
   INSERT INTO notice_claims (identifier, kind, notified_at) VALUES ($email, 'lockout', $now)
   ON CONFLICT (identifier, kind)
     DO UPDATE SET notified_at = $now
     WHERE notice_claims.notified_at < $now - LOCKOUT_NOTICE_WINDOW_MS
   RETURNING identifier;
   ```
   Returns `true` iff a row comes back (a fresh insert, or an update whose `WHERE` matched because
   the last notice is older than the window). Postgres row-locks the PK conflict, so of N
   concurrent callers exactly one sees `notified_at` still-old and gets a row; the rest re-evaluate
   the `WHERE` against the just-written `notified_at` (≈ `now`), fail it, and get nothing. After the
   window elapses (a genuinely new lock event) the claim succeeds again — one notice per lock event.
   - Window = `LOCKOUT_NOTICE_WINDOW_MS = LOCKOUT_WINDOW_MS` (1h, the lockout escalation cap).
   - Wrapped in a `try/catch` + `logError` with the same SEC-05 scrub as `consumeBudget` (the bound
     parameter is the recipient email; a raw Drizzle error must never escape into an `after()`/host
     log). But unlike `consumeBudget` (a courtesy-mail throttle, fail-closed) this gates a SECURITY
     alert, so it fails **OPEN** — on a claim-query error the notify proceeds (audit-security F-1). A
     dropped "your account is under attack" alert is worse than a rare duplicate, and the flood the
     claim prevents needs N racers erroring at once (genuine DB degradation, never attacker-driven).

3. **Both routes** change identically — the shared idiom, no special-casing (ASN-02 spirit):
   ```ts
   if (lockoutState(snap.failures.length + 1).shouldNotify && (await claimLockoutNotice(db, email, now)))
     await notifyLockout(email);
   ```
   `notifyLockout` is already best-effort and never blocks the response; the claim is an ordinary
   awaited DB call on the failure path (same cost class as the `incrementAttempt`/`ipFailureCount`
   calls already there).

## Definition of done
- [x] `otp/verify` emails the owner **exactly once** per lockout event, incl. under an N-way
      concurrent burst — proven end-to-end (`auth-lockout-notify.test.ts`).
- [~] `login` uses the identical idiom; its de-dup mechanism (the shared `claimLockoutNotice`) is
      proven under a 12-way concurrent burst by the **primitive** test, but there is **no login
      HTTP-level test** (needs a `cookies()`/Supabase-user harness this route lacks). Gap is
      deliberate and surfaced — see §Tests. A login HTTP test is a WP candidate, not done here.
- [x] Notices are **per-surface** (`lockout:login` vs `lockout:otp`) — a lock on one surface never
      suppresses the owner alert for the other (pr-review F-1). Proven by the cross-surface claim test.
- [x] `notice_claims` migration: table + PK index + RLS deny-by-default, applied to dev DB.
- [x] `claimLockoutNotice` atomic (onConflictDoUpdate + setWhere), fail-OPEN on error (security
      alert; audit-security F-1), SEC-05-safe.
- [x] TDD: AUT-04 integration tests, real red→green, ran non-skipped (counts in the summary).
- [x] Regression: auth suites green.
- [x] Self-audit checklist (PLAYBOOK §6) printed in the summary.
- [x] Reviews: pr-reviewer + audit-security + audit-data — none blocking. audit-data verified the
      single-winner claim three ways live (raw SQL, real fn via tsx, EXPLAIN) → exactly 1 winner every
      trial. audit-security F-1 (fail-open) folded. pr-reviewer F-1 (HTTP concurrent test red) was
      pool-contention from concurrent review probes on the 15-slot dev pooler — passes in isolation
      (audit-data F-7 confirmed 3/3 + 5/5). Scratch files removed (F-2/F-3). Retention deferred (F-4).
- [ ] Owner walkthrough. No commit until owner go.

## Tests (TDD — names carry AUT-04; integration self-skips without DATABASE_URL)
- `AUT-04: N concurrent wrong OTP codes at the tripping attempt email the owner exactly once`
  (`auth-lockout-notify.test.ts`) — seed 4 prior failures directly (reserve+settle-false, leaving
  the challenge's own attempt budget intact), then `Promise.all` 6 wrong-code verifies → exactly 1
  lockout email. Red against the current pre-settle-snapshot behaviour (observed 2), green after.
- `AUT-04: a wrong OTP code still emails the owner exactly once on the serial path` — unchanged
  guarantee (WP-SU-15's existing test, kept green as a regression).
- `AUT-04: claimLockoutNotice is an atomic once-per-window claim` (`lockout-notify-claim.test.ts`) —
  primitive-level: first claim `true`; second within the window `false`; a claim with `now`
  advanced past the window `true` again; **12 concurrent claims (one surface) → exactly one winner**;
  distinct identifiers each win; **the login and otp surfaces claim independently for the same
  identifier** (pr-review F-1 — proves no cross-surface suppression).
- Race-floor guard (pr-review F-3): the otp burst back-dates its 4 primed failures outside the
  15-min rate window (inside the 1h lockout window) so the requests aren't throttled at the gate,
  and asserts `≥ 2` reached the wrong-code branch — pinning the concurrency precondition so the
  test can't silently degrade to a non-race if throttle limits change.
- Red first (assert the concurrent burst against current behaviour + the missing symbol), then green.

**Login route coverage — deliberate decision.** The login route's change is byte-identical to
`otp/verify`'s (same one-line idiom, same `claimLockoutNotice`), and its actual de-dup mechanism is
the shared primitive, which the 12-way concurrent claim test exercises directly. A login *HTTP*
test would additionally need `next/headers` `cookies()` (via `getSupabaseServer()`) plus a real
provisioned Supabase user — machinery no existing test drives for this route — for no coverage the
primitive test doesn't already give. So login is covered by (a) the shared-primitive concurrent
test and (b) the otp end-to-end wiring test proving the identical idiom wires correctly. A future
HTTP-level login lockout test is a candidate if the auth route harness gains a cookies() seam.

## Out of scope (→ WP candidates, not built here)
- **F-5 (audit-security, deferred from WP-SU-15): `otp/verify` has no `withUniformTiming` floor** —
  unlike login/otp-request/reset-request. A distinct concern (an enumeration/timing oracle, not
  email de-dup) with its own test surface. **→ WP-SU-17** per owner decision (2026-07-31).
- **`notice_claims` retention sweep (audit-security F-1, this WP).** The table accretes one
  permanent plaintext-email row per distinct identifier that ever locks — slow, but with no sweep,
  unlike its auth siblings. Fold a `DELETE … WHERE notified_at < now() - LOCKOUT_NOTICE_WINDOW_MS`
  into the WP-SU-13 auth-sibling pruner (an aged row is exactly one the next claim would overwrite,
  so pruning it is safe). Low severity (login identifiers, not seller PII). **→ WP candidate.**
- Audit signup's lockout-notification coupling for the same class of gap (WP-SU-15 note).

## Known-and-accepted (documented, no action)
- **Window-boundary suppression (audit-security F-2).** The claim window is a rolling
  `LOCKOUT_NOTICE_WINDOW_MS` keyed on `notified_at`, not a per-lock-event id. A new lock that trips
  exactly as the previous notice ages across the boundary can have its courtesy email suppressed
  for at most one window. Bounded, self-healing, and enforcement is unaffected — accepted as the
  deliberate "one notice per rolling window" semantics.
- **Caller `now` vs DB `now()` (audit-security F-3).** The claim compares the route's `Date.now()`,
  matching how `attempts-store` threads `now`. A duplicate/over-suppression needs >1h clock skew
  between app instances (never, with NTP). Accepted.

## Notes / risks
- **Env / base branch:** this WP must be built on `phase-2/distribution`. A fresh worktree may
  start on the wrong base and/or lack `.env.local` → integration tests silently self-skip
  (false-green). Confirm the branch and copy `.env.local` first; read the pass/skip counts.
- Observability of the notification in tests uses the SEC-07 dev mailbox (`recentDevEmails` /
  `clearDevMailbox`) — the REAL `notifyLockout` path is exercised (no notify mock).
- Concurrent-count assertions are exact here (`=== 1`) because the claim is atomic — unlike the
  fail-closed *rate limiter* in `throttle-atomicity.test.ts`, which asserts a `<=` bound to avoid
  flakiness. The distinction is deliberate: a limiter may over-refuse; this claim must be exact.
- Before any commit: `git diff --cached --name-only` must NOT include `PRODUCT_BRIEF.md`,
  `WEBSITE-BRIEF.md`, or `docs/legal/`.
</content>
</invoke>
