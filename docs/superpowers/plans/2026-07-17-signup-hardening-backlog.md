# Signup Hardening Backlog — Implementation Plan (WP-SU-2 … WP-SU-7)

> **For agentic workers:** execute with superpowers:subagent-driven-development (or executing-plans),
> TDD per task. This project runs **COMMIT-FREE**: implementers STAGE (`git add`, no commit); the
> owner walks through and gives an explicit go before ONE commit per WP and a separate go before push.
> Steps use checkbox (`- [ ]`) tracking.

**Goal:** Land the six deferred hardening WPs from the public self-serve signup review gate
(commits c50be65 + a6f13fb, PR #1). All are Tier A (auth). Owner has pre-approved the two
design-bearing choices (see Global Decisions).

**Governing context:** design spec `docs/superpowers/specs/2026-07-16-self-serve-signup-design.md`;
ADR-0033 (self-signup) / ADR-0034 (Turnstile) / ADR-0032 (Sentry+cron monitors, `logError` seam).
Signup is gated OFF in production by `SIGNUP_ENABLED` — these harden it before go-live.

## Global Decisions (owner-approved 2026-07-16)

- **Abandoned-signup sweep:** 24h grace (= verification token TTL); alert via a **Sentry cron
  monitor** (ACT-05 pattern, `Sentry.withMonitor` + `CRON_MONITORS` drift test) **plus** a
  `logError` orphan-count signal. No schema change.
- **ToS re-acceptance guard:** add a `tenants.self_serve` boolean (migration), set true at signup,
  and gate **only** self-serve admins — so the script-provisioned owner admin (no ToS record) is
  never locked out.
- **Trusted-proxy IP:** prefer Vercel's `x-vercel-forwarded-for` (trusted edge value), then
  `x-real-ip`, then fall back to the first `x-forwarded-for` entry (dev / non-Vercel hosts).

## Global Constraints (copy verbatim into every task)

- Tier A: reviews before each commit — pr-reviewer + audit-security; add audit-tenancy for any
  scope/query change, audit-data for any migration, audit-devops for cron/CI/vercel.json.
- PRN-08: queries go through `lib/scope.ts`; the only cross-tenant ops are documented system ops
  (cron tenant-list; signup's `emailExistsGlobally`). PRN-05: never UPDATE historical assignments.
- SEC-05: never log passwords/tokens/OTP/seller PII (`logError` → Sentry per ADR-0032).
- AUT-03 rate-limit via `AuthAttemptsStore`; AUT-09 constant-time compares.
- Every schema change = migration + seed(if applicable) + RLS + index in the same PR (drizzle-kit:
  `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs generate|migrate`; inspect the
  generated SQL before applying — DM-08). Migration 0025 is the latest applied.
- Tests carry requirement IDs; vitest SERIAL `--no-file-parallelism`; integration self-skips without
  DATABASE_URL (read counts). Cron routes: `isAuthorizedCron(...)` bearer; wrap work in
  `Sentry.withMonitor`. Test cleanup that touches audited tenants must purge audit_log via
  `tests/helpers/audit.ts` `purgeAuditLog`.
- No new npm dependency without an ADR.

---

## WP-SU-2 — Abandoned/orphan-signup cleanup sweep (+ alert)  [HIGHEST VALUE]

**Why:** never-verified public signups (tenant+user+auth user+`signup_verifications` rows) and
`after()`-dropped orphans (WP-SU-1) accumulate with no cleanup or signal.

**Files:**
- Create: `src/modules/retention/signup-sweep.ts` (the sweep logic)
- Create: `src/app/api/cron/signup-sweep/route.ts` (cron route)
- Modify: `vercel.json` (add cron), `src/lib/cron-monitors.ts` (add monitor)
- Modify: `.env.example` if a new tunable is added (grace is a const — none needed)
- Create tests: `tests/integration/signup-sweep.test.ts`, extend `tests/unit/cron-monitors.test.ts`

**Mirror:** `src/modules/retention/sweep.ts` (bounded, idempotent, tenant-scoped per-tenant sweep)
and `src/app/api/cron/retention-sweep/route.ts` (auth + `Sentry.withMonitor` + per-tenant loop).

**Approach:**
- `SIGNUP_ABANDON_GRACE_MS = 24 * 60 * 60_000` (matches `SIGNUP_TTL_MS`).
- `sweepAbandonedSignups(db, admin, { tenantId, now })`: for the tenant, find `signup_verifications`
  rows past grace (`expiresAt <= now - 0`, i.e. expired) that are **unconsumed** (`usedAt is null`)
  → their `userId` is an unverified signup. For each: confirm the auth user is still
  `email_confirm:false` and the account is genuinely abandoned (never verified) → purge: delete the
  `users` row, `purgeAuditLog` the tenant's `tenant.signup_provisioned` row via the escape hatch,
  delete the `tenants` row, delete the `signup_verifications` row, and `admin.auth.admin.deleteUser`.
  Bounded batch (e.g. 200), idempotent. Returns `{ purged }`.
- **Orphan detection + alert:** separately, count Supabase auth users that are `email_confirm:false`,
  older than grace, with **no** matching `users` row (an `after()`-dropped provisioning). Use
  `admin.auth.admin.listUsers` paging (mirror `findAuthUserByEmail` in `provision.ts`) filtered by
  `created_at`. For each orphan: `admin.auth.admin.deleteUser` (reconcile) and increment a count.
  If `orphans > 0`, `logError("signup_orphan_reconciled", { count })` so the ACT-05 Sentry alert
  fires (per ADR-0033's WP-SU-1 note: a 200 with no verification row must alert, not just clean).
- Cron route: mirror `retention-sweep/route.ts` exactly — `isAuthorizedCron`, tenant list, wrap the
  per-tenant loop in `Sentry.withMonitor("signup-sweep", …, monitorConfig(MONITOR))`, best-effort per
  tenant (`logError` on a tenant failure), return `jsonOk({ code:"ok", tenants, purged, orphans })`.
- `vercel.json`: add `{ "path":"/api/cron/signup-sweep", "schedule":"30 3 * * *" }` (after the
  retention sweep). `cron-monitors.ts`: add `"/api/cron/signup-sweep": { slug:"signup-sweep",
  schedule:"30 3 * * *", checkinMargin:10, maxRuntime:5 }` — the existing drift test then covers it.

**TDD tasks:**
- [ ] Test (integration): seed a tenant+user+`signup_verifications` row with an EXPIRED unconsumed
      token (issue with a past `now`) → `sweepAbandonedSignups` purges all four rows + calls
      `admin.deleteUser`; a NON-expired or CONSUMED signup is left untouched. Use a fake admin
      (records deleteUser/listUsers). Purge audit_log in cleanup.
- [ ] Test: an orphan (listUsers returns an unconfirmed user with no `users` row, older than grace)
      is deleted and `logError("signup_orphan_reconciled", {count})` fires (spy on logError).
- [ ] Implement `signup-sweep.ts`, then the cron route (mirror retention-sweep), then vercel.json +
      cron-monitors entry.
- [ ] Extend `cron-monitors.test.ts` — the drift test already asserts every vercel.json cron has a
      monitor; confirm it now covers signup-sweep.
- [ ] Gate: `npx vitest run tests/integration/signup-sweep.test.ts tests/unit/cron-monitors.test.ts
      --no-file-parallelism`; typecheck + lint.

**Reviews:** pr-reviewer + audit-security + audit-devops (cron/vercel.json) + audit-data (queries).

---

## WP-SU-3 — `logError` message scrubbing at the seam  [SEC-05 defense-in-depth]

**Why:** `logError` forwards `detail` verbatim to Sentry; the SEC-05 no-PII guarantee rests only on
caller discipline. A driver/provider error message could embed an email/token. (Same posture
ADR-0032 already took with `beforeSend` for Sentry's own enrichment — extend it to caller `detail`.)

**Files:** Modify `src/lib/observability.ts`; extend `tests/unit/observability.test.ts`.

**Approach:** before `Sentry.captureMessage`, run `detail` through a scrubber that replaces
email-shaped (`\b[\w.+-]+@[\w-]+\.[\w.-]+\b`) and long hex/base64url token-shaped
(`\b[A-Za-z0-9_-]{24,}\b`) substrings in any string value with `"[redacted]"`. Keep the console line
unchanged (first-party) OR scrub both — **owner-adjustable; default: scrub only what reaches Sentry**
(the third party), leaving the console line intact for local debugging. Never throw (best-effort
contract preserved).

**TDD tasks:**
- [ ] Test: `logError("x", { message: "dupe email a@b.test rejected", token:"AAAA…24+" })` with a DSN
      set → the captured Sentry `extra` has the email and token replaced with `[redacted]`; without a
      DSN nothing is sent; still never throws.
- [ ] Implement a pure `scrubDetail(detail)` + apply it to the Sentry payload only.
- [ ] Gate + lint. **Reviews:** pr-reviewer + audit-security.

---

## WP-SU-4 — Trusted-proxy client IP  [affects all auth endpoints]

**Why:** `clientIp` trusts the first `x-forwarded-for`, which a client can spoof, so per-IP
rate-limits (login/reset/OTP/signup) are bypassable — abuse-bounding leans on CAPTCHA alone.

**Files:** Modify `src/lib/auth/client-ip.ts`; create `tests/unit/client-ip.test.ts`.

**Approach:** prefer `x-vercel-forwarded-for` (a single value set by Vercel's edge, not
client-appendable), then `x-real-ip`, then fall back to the first `x-forwarded-for` entry (dev /
non-Vercel). Document the trust assumption in the file header (only valid behind Vercel's proxy;
the fallback is best-effort). No behavior change in dev (no Vercel headers → XFF fallback).

**TDD tasks:**
- [ ] Test: `x-vercel-forwarded-for` present → returned even when `x-forwarded-for` differs
      (spoof ignored); only XFF present → first entry; neither → `x-real-ip`; none → null.
- [ ] Implement. [ ] Gate + lint. **Reviews:** pr-reviewer + audit-security.

Note: no other call site changes — every auth route already calls `clientIp(request)`.

---

## WP-SU-5 — Guard-level ToS re-acceptance for self-serve admins  [LARGEST; schema change]

**Why:** self-serve admins accept ToS at signup (recorded), but the shared `requireTosResponse`
guard exempts all admins, so a future `CURRENT_TOS_VERSION` bump would not re-prompt them. The owner
admin (no ToS record, provisioned by script) must NOT be caught.

**Files:**
- Migration: add `tenants.self_serve boolean not null default false` (+ generated migration/RLS).
- Modify: `src/db/schema.ts` (column), `src/lib/auth/provision-signup.ts` (set `self_serve:true`),
  `src/lib/auth/tos-guard.ts` (gate self-serve admins), and the admin app entry gate (see below).
- New admin ToS-acceptance surface (adapt the portal's ToS flow for admins).
- Tests: `tests/integration/tos-guard.test.ts` (or extend), provision-signup test (self_serve set).

**Approach:**
- Migration adds `self_serve` to `tenants` (default false; existing/owner tenants stay false).
  `provisionSignup` inserts `self_serve:true` for the new tenant.
- `requireTosResponse(db, scope)`: change the admin exemption from unconditional to
  "exempt admins whose tenant is NOT self_serve." For a self_serve admin, apply the same
  `latestTosVersion` / `needsTosAcceptance` check partners get. (Look up `tenants.self_serve` by
  `scope.tenantId` — a scoped read.)
- **Enforcement point for admins:** today `requireTosResponse` is called only on portal routes. Add
  it to the admin app so a self-serve admin who needs to (re)accept is gated: (a) a shared admin
  layout/server-guard that redirects to a `/tos` acceptance page when `requireTosResponse` trips,
  mirroring the portal's landing gate; and (b) defense-in-depth on admin data mutations. Reuse the
  existing ToS-acceptance UI/endpoint the portal uses (`recordTosAcceptance` via its accept route) —
  generalize it for admin role rather than duplicating.
- Because self-serve admins accepted `CURRENT_TOS_VERSION` at signup, the guard only bites after a
  version bump — verify the happy path (fresh self-serve admin passes) and the bump path (after
  bumping the version in a test, the self-serve admin is gated; the owner/non-self_serve admin is not).

**TDD tasks:**
- [ ] Migration + schema column; provision sets `self_serve:true` (extend provision-signup test).
- [ ] Test: `requireTosResponse` for a self_serve admin with no acceptance for the current version →
      403 `tos_required`; a non-self_serve (owner) admin → null (exempt); a self_serve admin who
      accepted the current version → null.
- [ ] Wire the admin entry gate + reuse the acceptance flow; test the redirect/gate.
- [ ] Gate + lint. **Reviews:** pr-reviewer + audit-security + audit-tenancy + audit-data (migration)
      + audit-compliance (LGL-01 closure).

**Scope note:** this is the biggest of the six (schema + guard + admin UI). If time-boxed, split into
5a (schema + guard + gating logic, tested) and 5b (admin acceptance UI).

---

## WP-SU-6 — Verify-endpoint throttle  [small, low urgency]

**Why:** `/api/auth/signup/verify` has no throttle, unlike every other credential endpoint (token
entropy makes guessing infeasible, so this is consistency + DB/Auth-load capping, not a live hole).

**Files:** Modify `src/lib/auth/throttle.ts` (add `VERIFY_THROTTLE`), `src/app/api/auth/signup/verify/route.ts`;
extend `tests/integration/signup-verify-route.test.ts`.

**Approach:** mirror the signup route's rate-limit block — `AuthAttemptsStore.snapshot(ip-or-token,
ip, "signup_verify", now, VERIFY_THROTTLE)` + `evaluateThrottle` → 429 + `Retry-After` on trip.
Key on IP (the token is the secret; don't log it). Add `VERIFY_THROTTLE` mirroring `RESET_THROTTLE`.

**TDD tasks:**
- [ ] Test: the Nth rapid verify from one IP → 429 + Retry-After.
- [ ] Implement. [ ] Gate + lint. **Reviews:** pr-reviewer + audit-security.

---

## WP-SU-7 — Slug-collision retry  [small]

**Why:** `provisionSignup`'s slug clash check is read-then-insert; a concurrent same-workspace-name
signup can hit the `tenants.slug` unique constraint → the tx fails → compensation → silent failure.

**Files:** Modify `src/lib/auth/provision-signup.ts`; extend `tests/integration/provision-signup.test.ts`.

**Approach:** wrap the tenant insert (or the whole tx) in a bounded retry (e.g. 3 attempts): on a
unique-violation on `tenants.slug` (Postgres code `23505`, constraint name contains `slug`), recompute
`slug` with a fresh random suffix and retry; after the last attempt, rethrow (→ compensation). The
auth user is created once (outside the retry); only the tx retries. Keep the compensating
`deleteUser` on final failure.

**TDD tasks:**
- [ ] Test: pre-insert a tenant with slug `acme`; `provisionSignup({workspaceName:"Acme"})` succeeds
      with a suffixed slug (not a failure). Simulate/force one collision then success.
- [ ] Implement the bounded retry. [ ] Gate + lint. **Reviews:** pr-reviewer + audit-data.

---

## Sequencing & notes

Build order = the WP numbering (highest value first). WP-SU-2, -3, -4, -6, -7 are independent; WP-SU-5
is the largest and can go last (or be split 5a/5b). Each WP is its own commit (commit-free → owner
walkthrough → commit → push), per cadence.

**Still owner reality-gate before flipping `SIGNUP_ENABLED` on (unchanged):** real ToS/Privacy text,
subprocessor page (Turnstile + Supabase + Resend), CCPA rights channel. WP-SU-5 assumes a real ToS
version exists; the mechanism works with the current placeholder version meanwhile.

**Self-review (spec coverage):** every review finding from the signup gate maps to a WP —
abandoned/orphan sweep+alert → SU-2; logError scrub (audit-sec F-2 / devops F-1 theme) → SU-3;
XFF spoof (audit-sec F-4) → SU-4; guard ToS re-acceptance (audit-compliance F-1 residual) → SU-5;
verify-throttle (audit-sec F-5) → SU-6; slug race (Opus #4 / audit-sec F-3) → SU-7. The enumeration
timing oracle (the one High) already shipped as WP-SU-1 (a6f13fb).
