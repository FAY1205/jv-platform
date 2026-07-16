# ADR-0033: Public self-serve admin signup (supersedes SCP-02's V1 closure)

- **Status:** Accepted (owner-approved, Phase D design session, 2026-07-16)
- **Date:** 2026-07-16
- **Phase / WP:** Phase D (Commercialize) · part 1 — self-serve onboarding
- **Amends:** SPEC §SCP-02 — the clause "Admin self-signup closed in V1 (accounts
  provisioned)" only. SCP-02's other clause, "no partner self-signup; admin invites,"
  is unchanged.

## Context

SCP-02 froze admin account creation in V1: admins are provisioned via `ADMIN_ALLOWLIST`
/ `scripts/provision-admin.ts`, and there is no signup page. That was correct while the
product was operated for a known set of internal tenants. Phase D (Commercialize) requires
the opposite: a prospective customer must be able to sign up on the public internet and
get their own workspace with no manual step. See the design spec
`docs/superpowers/specs/2026-07-16-self-serve-signup-design.md`.

The database is already multi-tenant and every scoped query filters by
`scope.tenantId`, derived from the authenticated user's Supabase `app_metadata.tenant_id`
(`src/lib/scope.ts`; PRN-08). So a new tenant is isolated by construction the moment its
admin's metadata names it — the hard part is not isolation, it is safely opening a public
account-creation surface without a self-signup oracle, bot flood, or half-provisioned
account.

## Decision

**Open public self-serve signup that creates a new, isolated tenant whose first user is
its admin.** Partner accounts are unaffected — they are still invited by their tenant's
admin (SCP-02 clause 1 stands).

- **One signup = one tenant + one admin user.** Reuses the existing `admin` role, so no
  new roles (Phase C stays out). The signer's Supabase `app_metadata` carries
  `{ tenant_id, role: "admin" }`, which drives `scope.ts` — automatic tenant isolation.
- **Verification gates activation.** The auth user is created `email_confirm: false`, so
  it cannot log in until the user clicks a verification link we issue. We drive the
  confirmation ourselves (our token + Supabase admin API), so the verification email goes
  through the app's own Resend transport and is **SEC-07-sinked in non-production** — no
  Supabase-sent email that could reach a real person from dev/preview.
- **Bot + abuse controls at the door:** Cloudflare Turnstile CAPTCHA (ADR-0034),
  IP rate-limiting via the existing `AuthAttemptsStore` (`signup` kind), and an
  enumeration-safe flow with uniform timing (AUT-05) — an already-registered email gets
  the same response and a "you already have an account" email, never an existence tell.
- **Provisioning is a compensating saga.** The Supabase auth user (external) is created
  first; the `tenants` + `users` rows are inserted in one DB transaction; if that
  transaction fails, the auth user is deleted — no orphaned accounts.
- **No new dependency for this ADR itself;** the CAPTCHA provider is decided separately in
  ADR-0034. No schema change beyond a hashed verification-token store (migration ships
  with index/seed/RLS per repo rule).

Rejected — **keep SCP-02 and provision every customer by hand:** does not scale to
self-serve commercialization and defeats the phase's purpose. Rejected — **Supabase-Auth-
native signUp with its built-in confirmation email:** those emails bypass the SEC-07 sink
(could email a real person in dev/preview) and make tenant provisioning a webhook/trigger
that is hard to make atomic and testable (design spec, Approach B).

## Consequences

- **Larger public attack surface** — this is the real cost. Account creation is now
  reachable by anyone, so the abuse controls above are load-bearing, not optional, and the
  new `/api/auth/signup` path is mandatory-review for audit-security + audit-tenancy on
  every change.
- **New follow-up work (WP candidates, not this WP):** a cleanup sweep for abandoned,
  never-verified signups (empty tenant/user rows + unconfirmed auth users accumulate);
  and, once ADR-0034's Turnstile is live, its subprocessor-page entry.
- **Billing interaction (deferred):** new tenants carry no plan field yet. When Phase D
  part 2 adds Stripe, signup will attach a default/free plan; this ADR intentionally does
  not gate signup on payment.
- **SCP-02 clause 1 is untouched:** partner self-signup remains closed; the partner portal
  is still invite-only. Anyone reading SCP-02 should also read this ADR.
- Reopens only if the product retreats from self-serve (unlikely) — in which case a
  further ADR would re-close the signup surface.

## Post-review clarifications

- **Scope driver:** isolation is enforced by the `users` row (keyed by the verified auth
  uid) that `scope.ts` reads; `app_metadata.tenant_id` mirrors it as the RLS backstop.
  `provisionSignup` writes both to the same fresh tenant id. (Corrects the Context/Decision
  wording above that said `app_metadata` "drives" scope.)
- **`signup_verifications` table:** enrolled in the closed pre-tenant, tenant-less
  auth-table exception set (with `auth_attempts`/`reset_tokens`/`otp_challenges`);
  isolation is by token capability (hash lookup + single-use), not tenant scope — no
  `tenant_id` column, deny-by-default RLS.
- **Verification token in URL:** the `/signup/verify?token=` link carries the token in the
  query string, mirroring the accepted `/reset?token=` pattern; mitigated by single-use +
  24h TTL + no third-party script on the verify page. Accepted residual risk.
- **ToS/Privacy consent:** captured at signup (required checkbox) and recorded via
  `recordTosAcceptance` in the provisioning transaction, satisfying LGL-01's
  acceptance-at-provisioning. Enforcing re-acceptance for self-serve admins at the guard
  layer is a follow-up WP (the shared `requireTosResponse` admin exemption is left intact
  to avoid locking out the script-provisioned owner admin, which has no ToS record).
- **Kill-switch:** public signup is gated by `SIGNUP_ENABLED` (off by default in
  production) so code-merge is decoupled from public go-live; flip on only after the
  ToS/Privacy text and subprocessor page (ADR-0034) are ready.
- **Provisioning-failure handling:** a provisioning failure is logged (`logError` →
  Sentry, no PII) and returns the SAME uniform "check your email" response — NOT a 500. A
  500 only on the new-email path would itself be an enumeration oracle. (This supersedes
  the design spec's original "return a 500 with traceId" wording — see the design spec's
  Error handling section.)
- **Enumeration timing (resolved, WP-SU-1):** heavy per-branch signup work (provisioning +
  emails) now runs via Next `after()` after the response; only the symmetric
  attempt-record + existence check are in-request, so the uniform floor equalizes both
  branches. **Trade-off:** provisioning is now best-effort *after* the acknowledged 200 —
  if the `after()` callback is evicted/times out, a "check your email" 200 can leave no
  tenant/user with only a `logError` signal (best case). The abandoned-signup cleanup
  sweep (above) must therefore also **alert** when a signup returned 200 but no
  `signup_verifications` row exists after a grace window — not just clean up.
