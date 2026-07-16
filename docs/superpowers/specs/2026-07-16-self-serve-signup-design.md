# Design: Public self-serve signup & tenant onboarding

- **Date:** 2026-07-16
- **Phase / WP:** Phase D (Commercialize) · part 1 of 3 — self-serve onboarding
- **Status:** Design — awaiting owner approval before an implementation plan
- **Tier:** A (auth, schema/RLS, tenancy, a new subprocessor)

## Goal

Let a brand-new customer sign up on the public internet, create their own isolated
workspace, verify their email, and land in the (empty) app as its admin — with no manual
provisioning. This is the first of Phase D's three independent pieces; **Stripe billing**
and **white-label** are explicitly out of scope here and get their own specs later.

## Non-goals (deliberately deferred)

- Team invites / additional roles inside a workspace → Phase C.
- Billing, plans, payment gating at signup → Phase D part 2. New tenants carry no plan
  field yet.
- Guided onboarding wizard, sample/demo data, product tour → the owner chose "minimal:
  land in the empty app."
- A cleanup sweep for abandoned, never-verified signups → follow-up WP candidate (see
  Open items).

## The security-model change (this is the crux)

Today the platform is `SCP-02`: **no self-signup — admins are provisioned** via the
`ADMIN_ALLOWLIST` / `provision-admin.ts` script. This design **reverses that**: account
creation becomes open to the public. That is the single biggest decision here and the
main source of risk, so it gets its own ADR (0033) that supersedes SCP-02. The existing
provisioned/allowlist path for the internal owner tenant is unaffected and continues to
work — self-signup is additive, creating *new* tenants.

Why this is safe by construction: every scoped query in the app already filters by
`scope.tenantId`, derived from the authenticated user's Supabase `app_metadata.tenant_id`
(`src/lib/scope.ts` `tenantWhere` = `eq(table.tenantId, scope.tenantId)`; PRN-08). A
freshly created tenant is therefore isolated the instant its admin's `app_metadata` names
it — no new isolation code, and no query path can cross into another tenant.

## What one signup produces

A single signup creates exactly two rows plus one auth user, all consistent:

1. A `tenants` row (id, name = workspace name, generated unique `slug`, default timezone).
2. A `users` row: `id` = the Supabase auth user id, `tenantId` = the new tenant, `role` =
   `admin`, `partnerId` = null.
3. A Supabase auth user created with `email_confirm: false` and
   `app_metadata: { tenant_id, role: "admin" }`.

Because `email_confirm` is false, `signInWithPassword` refuses the account until
verification — so an unverified signup cannot log in or touch anything. No new
`status`/`active` column is needed; Supabase's confirmation flag is the activation gate,
but **we** drive it (see Verification) so no Supabase-sent email is involved.

## Data model

Minimal. Reuse `tenants` and `users` unchanged. Add one hashed, single-use, TTL-bounded
**email-verification token**, modeled on the existing `ResetStore` (`src/lib/auth/
reset-store.ts` / `reset-token.ts`): store only the hash, verify constant-time, mark used.
One migration adds the store (a dedicated `signup_verifications` table, or a new token
`kind` on the existing token store — decided at plan time) plus its index. Per the repo
rule, the migration ships with seed/RLS/index in the same PR.

## Flows

### `POST /api/auth/signup`  (public, unauthenticated)

Input (Zod-validated, uniform `{code,message,traceId}` envelope): `email`, `password`
(zxcvbn-checked per ADR-0005), `workspaceName`, `captchaToken`.

1. **Rate-limit** by IP via `AuthAttemptsStore` with a new `signup` kind + existing
   throttle/backoff (`evaluateThrottle`). Refuse with 429 + `Retry-After` when exceeded.
2. **Verify the CAPTCHA** server-side: POST the token to Turnstile `siteverify` (a plain
   `fetch`, same shape as `ResendTransport`). Reject on failure before any account work.
3. **Enumeration-safe branch.** Look up the email. If it already exists: do **not** create
   anything; send a "you already have an account" email and return the **same** success
   envelope as a fresh signup. If new: continue. Wrap the whole handler in
   `withUniformTiming` (the existing floor) so the two branches are indistinguishable by
   timing — no account-existence oracle (AUT-05).
4. **Provision (compensating saga, since two systems are involved):**
   a. `admin.auth.admin.createUser({ email, password, email_confirm: false, app_metadata:
      { tenant_id, role: "admin" } })` → get the auth user id. (tenant_id is a
      pre-generated uuid.)
   b. In a single DB transaction: insert the `tenants` row (id = that uuid) and the
      `users` row (id = auth user id). On any failure, `admin.deleteUser(authUserId)` to
      compensate, then surface a server error — never leave an orphan auth user.
5. **Issue + send verification.** Persist a hashed token via the ResetStore-style store;
   email the link through the app's Resend transport (`notifySignupVerify`), which is
   SEC-07-sinked in non-production. The OTP/token itself is never logged (SEC-05).
6. Return the uniform "check your email to finish signing up" envelope.

### Verification: `/signup/verify?token=…` (GET landing) → `POST /api/auth/signup/verify`

The email link is a **GET** to the `/signup/verify` landing page carrying the token in the
query string; the page presents a confirm action that **POSTs** the token to the endpoint.
This mirrors the existing `/reset?token=…` flow and avoids an email-scanner's automatic
GET silently consuming a single-use token. (ADR-0032's `beforeSend` already strips query
strings before any error reaches Sentry, so the token never leaks through observability.)

1. Validate the token constant-time against its stored hash; reject expired/used/unknown
   uniformly.
2. On success: `admin.updateUserById(userId, { email_confirm: true })` — activating login
   — and mark the token used.
3. Redirect to `/login` (or straight into the workspace). The admin lands in their empty
   app and configures coverage/partners/uploads using the existing product.

## CAPTCHA — Cloudflare Turnstile (ADR 0034)

Client renders the Turnstile widget (a `<script>` tag; **no npm dependency**); the token
posts to the signup endpoint; the server validates via `siteverify`. Two env vars:
`TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET_KEY` (server, typed in `env.ts`).
Turnstile is a new third-party service and **subprocessor** — it needs the ADR and a line
on the subprocessor page. Chosen over hCaptcha/reCAPTCHA for its free tier, privacy
posture, and low user friction.

## UI

- `/signup`: email, password (with the existing strength meter), workspace name, the
  Turnstile widget. Built from `src/components` with every interactive state
  (default/hover/focus-visible/active/disabled/loading) and the uniform error envelope
  surfaced inline. A link to `/login` for existing users.
- A small verify-landing page for the token round-trip (loading/success/error/expired
  states).
- No wizard (minimal onboarding).

## Error handling

- All endpoints return the uniform `{code,message,traceId}` envelope; `logError` carries
  the traceId (and now reaches Sentry per ADR-0032) — never a password, token, or the
  new user's email in a way that violates SEC-05.
- Provisioning failure compensates (orphan auth-user deletion) and returns a 500 with a
  traceId; the client shows a retryable error.
- Turnstile/`siteverify` failure → 400 "verification failed," no account work done.
- Rate-limit → 429 with `Retry-After`.

## Testing (TDD; TST-mapped)

- **Provisioning:** signup creates exactly one tenant + one admin user, ids consistent,
  auth user unconfirmed until verified. Transaction rollback + auth-user compensation on
  a forced DB failure (no orphan).
- **Isolation (tenancy):** a new tenant's admin sees only its own (empty) data; a second
  signup's data is invisible to the first — asserted through `scope.ts`.
- **Enumeration/timing (AUT-05):** existing-email and new-email signups return identical
  envelopes and are within the uniform-timing floor; no duplicate account created for an
  existing email.
- **Verification:** unverified user cannot log in; a valid token activates; expired/used/
  unknown tokens are rejected constant-time; token is single-use.
- **CAPTCHA:** a missing/invalid Turnstile token is rejected before any account work;
  `siteverify` is called with the secret and never logs it.
- **Rate limit:** Nth rapid signup from one IP is throttled (429 + Retry-After).
- **SEC-07:** in non-production the verification email is captured to the sink, never a
  real recipient (reuses the WP-GL-E transport tests' pattern).

## Artifacts & process

- **ADR-0033** — self-serve signup, superseding SCP-02 (the auth/tenancy model change).
- **ADR-0034** — Cloudflare Turnstile as the CAPTCHA provider + subprocessor.
- This spec, then a TDD implementation plan (writing-plans). Both ADRs approved by the
  owner **before** any code, per the cadence. Reviews before commit: pr-reviewer +
  audit-security + audit-tenancy (mandatory — new tenant-creation path) + audit-compliance
  (new subprocessor + public PII collection).

## Open items / follow-up WP candidates

- **Abandoned-signup cleanup:** never-verified auth users + their empty tenant/user rows
  accumulate. A periodic sweep (like the retention cron) should purge signups unverified
  past a grace window. Not MVP; flagged as a WP candidate.
- **Slug collisions:** workspace-name → slug generation needs a uniqueness strategy
  (suffix on collision); nailed at plan time.
- **Password reset for a self-serve admin:** the existing reset flow should already work
  (same Supabase user model) — verify during implementation, add coverage if not.
