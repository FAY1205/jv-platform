# WP-SU-13 — Auth sibling-table retention (design)

- **Date:** 2026-07-30
- **Phase / WP:** Phase 2 (Distribution) · WP-SU-13
- **Tier:** B (data-layer + security-adjacent) — treat with Tier-A scrutiny (per the WP-SU-11 pr-reviewer note)
- **Branch:** `phase-2/distribution`
- **Follows:** WP-SU-11 (`auth_attempts` retention sweep) and its audit-security review (finding F-3)
- **Governing rules:** ADR-0010 (derive cutoffs from live constants, never restate literals),
  ADR-0032 (cron monitors + bolt-on best-effort pass rule §106-115), ADR-0025 (retention),
  ADR-0033 (tenant-less auth-table exemption), PRN-01, PRN-08, SEC-05, SEC-07.

## 1. Problem

WP-SU-11 prunes `auth_attempts`. The same **unbounded-growth + PII-retention** class exists on
four sibling pre-tenant auth tables, and nothing prunes their dead rows:

| Table | Sharp data | Pruned today by | Residue that lives forever |
|---|---|---|---|
| `otp_challenges` | **raw lowercased email** in `identifier` (schema ~L617) | nothing | every consumed/expired challenge |
| `reset_tokens` | `userId` + token hash | nothing | every used/expired token |
| `signup_verifications` | `userId` + token hash | `signup-sweep.ts` — **only expired + unconsumed** rows | **used (happy-path) rows** accumulate |
| `trusted_devices` | **IP** (schema ~L661) | nothing | expired/revoked rows keep their IP |

This is a data-minimisation gap (GDPR Art. 5(1)(c)/(e) in spirit) — the same class WP-SU-11 closed
for `auth_attempts`. `otp_challenges` is the sharpest: a raw third-party email retained forever.

**Also (audit-security F-3):** WP-SU-11 uses one uniform cutoff (global max read window +30d ≈ 31d)
for **all** `auth_attempts` kinds. `signup_notice` rows record the raw email address of a person an
attacker merely *named* at signup — read only within `ALREADY_REGISTERED_CAP.windowMs` (24h) — yet
kept ~31 days. The sharpest rows are the most over-retained.

## 2. Confirmed grounding (read from the live code, not restated)

Derivation-source constants:

- `OTP_TTL_MS = 10 * 60_000` (`src/lib/auth/otp.ts:9`)
- `RESET_TTL_MS = 30 * 60_000` (`src/lib/auth/reset-token.ts:9`)
- `SIGNUP_TTL_MS = 24 * 60 * 60_000` (`src/lib/auth/signup-token.ts:9`)
- `REFRESH_ABSOLUTE_MS = 30 * 24 * 3_600_000` (`src/lib/auth/refresh.ts:10`) — embedded into
  `trusted_devices.expiresAt` at issue time
- `ALREADY_REGISTERED_CAP.windowMs = 86_400_000` (24h) (`src/lib/auth/throttle.ts:139`)
- `LOCKOUT_WINDOW_MS`, and every `ThrottleConfig`/`RateRule` window in `throttle.ts` (all ≤ 1h
  except `ALREADY_REGISTERED_CAP`)

Read paths (why each cutoff is safe):

- **`otp_challenges`** — `OtpStore.latestActive` reads the most-recent **unconsumed** row by
  `identifier`; expiry is enforced in-app against `expiresAt`. A row older than `OTP_TTL_MS` is
  expired and unreadable-for-auth regardless of consumed state. (`src/lib/auth/otp-store.ts`)
- **`reset_tokens`** — `ResetStore.findByHash`; `verifyResetToken` rejects past `expiresAt`
  (30m). (`src/lib/auth/reset-store.ts`, `reset-token.ts`)
- **`signup_verifications`** — `SignupStore.findByHash`; `verifySignupToken` rejects `used`/`expired`
  (24h). **`signup-sweep.ts` (`sweepAbandonedSignups`) already sweeps expired + `isNull(usedAt)`
  rows and uses them as its abandoned-tenant detection signal.** Used rows are never swept there.
  (`src/lib/auth/signup-store.ts`, `src/modules/retention/signup-sweep.ts`)
- **`trusted_devices`** — `rotate` (by `tokenHash`, loads the family), `listForUser` (keeps only a
  live head: not rotated, not revoked, `expiresAt > now`), `familyScope`. Every read stops
  mattering to a live decision once the row is past `expiresAt`. (`src/lib/auth/trusted-device.ts`)

RLS (why **no migration**): all four tables are `ENABLE ROW LEVEL SECURITY`, deny-by-default,
service-role managed — migrations `0005` (reset), `0006` (otp), `0007` (trusted_devices),
`0025` (signup_verifications). A delete needs no schema change.

## 3. Shape (mirrors `sweepAuthAttempts` exactly)

Every pass: **select-oldest-first → delete-by-id, batched, idempotent, no transaction**, `now`
injected so the cutoff is a **pure** function (PRN-01 in spirit). Delete-only (§2 RLS → no
migration). No audit row (these are auth bookkeeping with no business meaning; an audit row would
re-persist the very email/IP the delete removes into an append-only table). Each pass is a
**best-effort bolt-on** on the daily `retention-sweep` cron behind its **own** `cron_*_sweep_failed`
code — it must **not** be able to fail the LGL-02 consumer-PII monitor check-in (ADR-0032 §106-115).

## 4. Architecture — shared primitive + thin policies

```
src/modules/retention/
  batched-delete.ts    NEW   generic select-oldest-then-delete-by-id loop:
                             (db, { table, id, orderBy, where, limit }) -> { deleted }
  auth-tables.ts       NEW   the four sibling policies: per-table derived cutoff + predicate
                             + exported constants consumed by the tripwire tests
  auth-attempts.ts     EDIT  single cutoff -> kind->retention map (F-3); reuse batched-delete
```

`auth-attempts.ts` is refactored onto the shared primitive **only because F-3 already reopens it**.
The other three retention files (`purge.ts`, `sweep.ts`, `signup-sweep.ts`) are untouched (no
unrelated refactor).

## 5. Per-table policy

Shared margin: **`AUTH_TABLE_RETENTION_MARGIN_MS = 7 days`** (see §7).

| Table | Anchor col | Cutoff | Extra predicate | Derived from |
|---|---|---|---|---|
| `otp_challenges` | `createdAt` | `now − (OTP_TTL_MS + M)` | — | `OTP_TTL_MS` |
| `reset_tokens` | `createdAt` | `now − (RESET_TTL_MS + M)` | — | `RESET_TTL_MS` |
| `signup_verifications` | `createdAt` | `now − (SIGNUP_TTL_MS + M)` | **`usedAt IS NOT NULL`** | `SIGNUP_TTL_MS` |
| `trusted_devices` | `expiresAt` | `now − M` | — | `REFRESH_ABSOLUTE_MS` (already in `expiresAt`) |

- **`signup_verifications` — `usedAt IS NOT NULL` is load-bearing.** The pass never removes an
  unconsumed row, so `signup-sweep`'s expired-unconsumed abandonment signal is untouched. This pass
  closes exactly the residue `signup-sweep` leaves: happy-path **used** rows.
- **`trusted_devices` — `expiresAt`-anchored** covers expired and revoked-then-expired rows
  uniformly (`expiresAt` embeds the 30d lifetime; `M` above it clears clock skew / any in-flight
  rotation). Accepted cost: a revoked-but-not-yet-expired row keeps its IP until its natural ≤30d
  expiry. `tenantId` is present but the pass is a documented cross-tenant system op (PRN-08
  exemption, same class as `signup-sweep`'s reconcile / the cron tenant list) — the predicate is an
  age condition, not a scope.

## 6. F-3 — `auth_attempts` kind→retention map

`authAttemptsRetentionForKind(kind)`:

- **`signup_notice` → `ALREADY_REGISTERED_CAP.windowMs` (24h) + M** — down from ~31d.
- **every other kind → the existing global max + existing 30-day margin** — unchanged, the **safe
  fallback**: a kind not explicitly mapped can never be under-retained.

The sweep runs two age-predicate passes (or one predicate with a per-kind cutoff): `signup_notice`
rows at the short cutoff, all other kinds at the global cutoff.

**Tripwire (extends the WP-SU-11 reflective test):**
1. Keep the existing "every exported throttle window ≤ global max" enumeration (guards the fallback).
2. `signup_notice` retention **≥** `ALREADY_REGISTERED_CAP.windowMs` — **derived from the live
   constant**, so a restated literal fails the build.
3. `signup_notice` retention **strictly <** the global default — proves the refinement actually bites.

**Must verify under TDD (implementation):** that `ALREADY_REGISTERED_CAP` counts the `signup_notice`
kind specifically (grep the cap's count query). The map is designed so that if this is wrong, the
un-mapped kind still falls to the safe global default — the risk is over-retention, never
under-retention.

## 7. Margin `M`

One shared **`AUTH_TABLE_RETENTION_MARGIN_MS = 7 days`** for the four sibling passes and the
`signup_notice` override:

- ≥ ~1000× the minute-scale TTLs (otp 10m, reset 30m) and 7× the 24h ones — the sweep cannot race a
  live read.
- Meets the ≥7-day floor the WP-SU-11 tripwire already asserts.
- Keeps raw third-party emails (`otp_challenges.identifier`, `signup_notice`) to ≤~8 days instead of
  ~31 — the F-3 minimisation intent.

`auth_attempts` **non-notice** kinds keep their existing 30-day margin (untouched). *Open to bumping
the sibling margin to 30d for cross-file consistency if preferred — flag at spec review.*

## 8. Tests (TDD, requirement IDs in names)

Pure/unit (`tests/unit/…`), no DB:
- Per-table cutoff derived-from-constant assertions (`SU-13-OTP-01`, `-RST-01`, `-SGN-01`,
  `-DEV-01`).
- Reflective tripwire per table: `retention ≥ read-window`, derived not restated — restated literal
  fails the build.
- F-3 map tests (`SU-13-F3-*`): §6 assertions 1-3.

Integration (`tests/integration/…`, **self-skips silently without `DATABASE_URL`** — read the run
counts, do not trust green; per the worktree-false-green lesson):
- Each pass deletes past-cutoff rows, preserves in-window rows, is idempotent (second run = 0), and
  honours the batch bound.
- `signup_verifications`: **used** past-cutoff rows deleted; **unconsumed** rows preserved (left for
  `signup-sweep`).
- `trusted_devices`: past-`expiresAt` rows (expired and revoked) deleted; a live-head row preserved.

Cron (`tests/…` route test): each new pass best-effort; a thrown pass logs its `cron_*_sweep_failed`
and the `retention-sweep` monitor check-in still resolves (LGL-02 stays green).

## 9. Cron wiring

`src/app/api/cron/retention-sweep/route.ts`: add four best-effort `try/catch` passes after the
`auth_attempts` pass, each logging its own code on throw; add their counts to the 200 response
(`{ tenants, purged, authAttempts, otpChallenges, resetTokens, signupVerifications, trustedDevices }`).
No change to the tenant loop or the monitor semantics.

New `logError` codes (append to **ADR-0032 Consequences**, with a one-line note each + the F-3 note):
`cron_otp_challenges_sweep_failed`, `cron_reset_tokens_sweep_failed`,
`cron_signup_verifications_sweep_failed`, `cron_trusted_devices_sweep_failed`.

## 10. Process / guardrails

- Commit-free until owner go. Before any `git add`, run `git diff --cached --name-only`; **never**
  stage `PRODUCT_BRIEF.md`, `WEBSITE-BRIEF.md`, or `docs/legal/`.
- vitest **serial** (`--no-file-parallelism`).
- Self-audit (PLAYBOOK §6) printed in the summary.
- Reviews after build: `pr-reviewer` + `audit-data` + `audit-security` + `audit-devops` (cron).
- **All work lands in the main repo `C:\Personal_Applications\JV_Leads` on `phase-2/distribution`**
  — the spawning worktree is a divergent branch and is not the target.

## 11. Candidate follow-ups (NOT built here)

- Fuller per-kind minimisation of `login` / `otp` / `reset` identifier emails in `auth_attempts`
  (also PII, less sharp than `signup_notice`).
- Revoked-early IP purge for `trusted_devices` (`revokedAt`-anchored) if the ≤30d IP retention on
  explicitly-revoked devices is later judged too long.
- Rate-match sweep cadence/batch to insert rate if abuse volume is ever observed (shared with
  WP-SU-11 / ADR-0010's Redis-swap trigger).
```
