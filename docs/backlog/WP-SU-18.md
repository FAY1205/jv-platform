# WP-SU-18: notice_claims retention sweep (data minimisation)
Spec: SEC-05 · ADR-0010 (data-min) · Phase: 2 · Tier: A · Depends: WP-SU-16 (notice_claims table, migration 0028), WP-SU-13 (auth-sibling pruner)

## Problem (audit-security F-1 on WP-SU-16, verified 2026-07-31 @ claude/wp-su-16)
`notice_claims` (WP-SU-16) backs the atomic lockout-notify de-dup. Its row key is the lowercased
login/OTP **email in plaintext** (`identifier`), one row per (identifier, surface), updated in place.
So it does not grow per-event — but it accretes **one permanent plaintext-email row per distinct
identifier that ever locks out**, and **nothing prunes it**. Every auth SIBLING that holds raw
emails or token material is swept (auth_attempts → WP-SU-11; otp_challenges / reset_tokens /
signup_verifications → WP-SU-13; trusted_devices → WP-SU-14). `notice_claims` is the one gap — the
same data-minimisation asymmetry ADR-0010 named for auth_attempts.

Sweep, not hash (audit-security's named alternative, rejected): `identifier` is a plaintext email,
the exact class as `otp_challenges.identifier`, which the WP-SU-13 pruner SWEEPS (keeps ~8 days),
not hashes. `reset_tokens` hashes because its value is a SECRET; an email is not. Hashing would also
mean editing WP-SU-16's `claimLockoutNotice`. Sweeping is sibling-consistent and additive.

## Design — join the WP-SU-13 pruner via the shared helper
The five existing sweeps all go through `batchedDeleteByAge` (retention/batched-delete.ts, "the one
place the delete loop lives"), whose documented INVARIANT is a single `uuid` PK for the
delete-by-id set. `notice_claims` is the codebase's lone table WITHOUT a uuid PK (composite PK on
identifier,kind). Best practice is to remove that anomaly so the new sweep reuses the reviewed
helper with zero bespoke SQL — not to add a second anomaly (a raw `ctid` sweep) to accommodate the
first.

1. **Schema (migration 0029)** — give `notice_claims` a surrogate `id uuid` PK (matching every
   other table) and demote `(identifier, kind)` to a `UNIQUE` constraint. The unique constraint is
   still a valid `ON CONFLICT (identifier, kind)` target, so `claimLockoutNotice` is unchanged. RLS
   already deny-by-default (0028); a delete-only sweep needs no policy change (batched-delete.ts).

2. **`sweepNoticeClaims` / `noticeClaimsCutoff`** in `retention/auth-tables.ts`, alongside the
   siblings, via `batchedDeleteByAge` (id = `noticeClaims.id`, orderBy = `notifiedAt`, where =
   `lte(notifiedAt, cutoff)`, limit = `AUTH_TABLE_SWEEP_BATCH`).
   - Cutoff is **DERIVED, never a restated literal** (ADR-0010):
     `NOTICE_CLAIMS_RETENTION_MS = LOCKOUT_NOTICE_WINDOW_MS + AUTH_TABLE_RETENTION_MARGIN_MS`.
     `LOCKOUT_NOTICE_WINDOW_MS` (1h) IS the whole live-read window — a row older than it is exactly
     one the next claim would overwrite (`claimLockoutNotice`'s `setWhere: notified_at < now-window`),
     so pruning past window+margin can never race a live claim. Keeps the plaintext email ~7 days
     after the identifier's last lockout — the same margin/rationale as the siblings.

3. **Cron** — add `sweepNoticeClaims` to the `retention-sweep` route's `Promise.all`, each pass
   behind its own best-effort catch code (`cron_notice_claims_sweep_failed`) and a return field,
   exactly like the other four hygiene passes (the tenant-PII purge stays first + sequential).

## Definition of done
- [x] `notice_claims` has a uuid `id` PK + `UNIQUE(identifier, kind)`; `claimLockoutNotice` still
      claims atomically (single-winner) against the unique constraint — WP-SU-16 claim suite (incl.
      the 12-way concurrent test) stays green post-change.
- [x] Migration 0029 applied to dev DB; `drizzle-kit check` clean ("Everything's fine").
- [x] `sweepNoticeClaims` prunes rows past `notifiedAt` cutoff (boundary inclusive), bounded +
      idempotent, cutoff derived from `LOCKOUT_NOTICE_WINDOW_MS` (SU-18-NTC-04 guards no restated literal).
- [x] Wired into the retention-sweep cron with its own alert code + return field.
- [x] TDD: retention integration tests, real red→green, non-skipped (4 pass; counts in summary).
- [x] Regression: unit 952/952 (+2 WP-SU-18 cron tests); retention suites (unit 29 + integration 18)
      green after the shared-helper change; claim + route suites green.
- [x] Self-audit (PLAYBOOK §6) printed in the summary. Reviews: pr-reviewer + audit-security +
      audit-data — all folded (details below); none blocking.
- [ ] Owner walkthrough. No commit until owner go.

## Review findings — folded
- **batchedDeleteByAge SELECT→DELETE TOCTOU** (pr-reviewer F-1 Medium, audit-security F-1,
  audit-data #2): the shared helper deleted by captured id set without re-asserting the age
  predicate — a no-op for the append-only siblings, but `notice_claims` is the first swept table
  the live path UPDATEs in place, so a mid-sweep re-lock could delete a just-refreshed claim → one
  benign duplicate email. **FIXED** in `batched-delete.ts`: the DELETE now re-asserts `spec.where`
  (`and(inArray(id, ids), spec.where)`) — no-op for siblings, strictly safer for trusted_devices,
  closes the race for notice_claims. All 5 sweeps re-verified green.
- **Migration 0029 lock/rewrite note** (audit-data #1 Medium): `gen_random_uuid()` default forces a
  full rewrite under ACCESS EXCLUSIVE — safe only because the table is empty. Added a forward-only
  comment (0027 precedent) warning not to replay on a populated table (use expand/contract).
- **Doc accuracy** (audit-data #3, pr-reviewer F-3, audit-security F-1a): corrected the
  "primary-key conflict" wording (now a UNIQUE constraint) and the "three tables" ACCEPTED-COST
  enumeration (now four). No behaviour change.
- Confirmed by all three: ON CONFLICT arbiter valid post-swap (12-way concurrent claim green),
  RLS deny-by-default untouched, SEC-05 scrub intact, PRN-08 pre-tenant exemption correct,
  cutoff derived (ADR-0010).

## Tests (TDD — integration self-skips without DATABASE_URL)
- `SU-18-NTC-01: sweepNoticeClaims deletes rows past the cutoff (boundary inclusive), keeps
  in-window rows` — seed ancient / at-cutoff / just-inside / fresh via `notifiedAt`; drain backlog
  first (WP-SU-11 pattern) for exact counts.
- `SU-18-NTC-02: idempotent — a second sweep at the same instant deletes nothing`.
- `SU-18-NTC-03: bounded per run — limit caps rows removed, remainder drains next run`.
- `SU-18-NTC-04: the cutoff is derived from LOCKOUT_NOTICE_WINDOW_MS + margin` (guards ADR-0010:
  a restated literal would drift).
- Regression: the WP-SU-16 claim suite (`lockout-notify-claim.test.ts`) stays green after the PK →
  unique change (the concurrent single-winner claim now conflicts on the unique constraint).

## Out of scope
- No change to `claimLockoutNotice` behaviour, the routes, or the lockout ladder.
- A covering index on `notified_at` — same ACCEPTED COST as the siblings (unindexed seq-scan once
  daily at this table's volume is cheaper than write-path index maintenance; ADR-0010).

## Notes
- Env / base branch: build on `claude/wp-su-16` (this WP layers on WP-SU-16's uncommitted table).
  Copy `.env.local` into a fresh worktree or the integration tests self-skip (false green).
- Before any commit: `git diff --cached --name-only` must NOT include `PRODUCT_BRIEF.md`,
  `WEBSITE-BRIEF.md`, or `docs/legal/`.
