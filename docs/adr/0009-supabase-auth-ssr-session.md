# ADR-0009: Supabase Auth via @supabase/ssr; scope from the users table

- **Status:** Accepted
- **Date:** 2026-07-08
- **Phase / WP:** Phase 2 / WP-023

## Context

The stack is locked (§13) to **Supabase (Postgres + Auth incl. email OTP)**. Phase 1 shipped
a dev-scope stub (`src/lib/scope-context.ts`) that hardcoded the dev tenant as admin. Phase 2
replaces it with real authentication: the whole portal and every scoped view depend on a
`getServerScope` resolved from the authenticated session (AUT-01/02/05/09/12/13). Spec §6.18's
"delegation boundary" says Supabase supplies the auth primitives (hashing, OTP, refresh
rotation) and the app builds the responsibilities on top.

## Decision

Add **@supabase/ssr** + **@supabase/supabase-js**. The session is managed by Supabase Auth
through `@supabase/ssr` cookie handlers bound to the App-Router cookie store; a `proxy.ts`
(Next 16's renamed middleware) refreshes the session and writes rotated cookies back.

- **Scope source:** `getServerScope` calls `supabase.auth.getUser()` (verifies the JWT), then
  resolves tenant/role/partner from the authoritative **`users` row keyed by the verified auth
  uid** — never from client-supplied claims. The DB row is the single source of truth (PRN-15
  spirit); `app_metadata` still carries tenant_id/role so the RLS backstop (0001 migration) has
  claims for any future authenticated DB path. The scope guard (`lib/scope.ts`) and RLS are
  unchanged — only the source of the scope changed.
- **Cookie (AUT-12):** `__Host-jv-auth`, HttpOnly, Secure, SameSite=Lax, Path=/. Modern browsers
  accept Secure/`__Host-` cookies over `http://localhost`, so dev works without HTTPS.
- The Phase-0 hand-rolled primitives (`cookies.ts`, `refresh.ts`) are **not** the session; they
  are reserved for the app-owned device-session registry (ACC-02, WP-024). `enumeration.ts`,
  `password.ts`, `constant-time.ts` are used as-is for the app-layer responsibilities.

## Consequences

- Two runtime deps, both spec-mandated by §13. Recorded per "no new deps without an ADR".
- Auth resolution is live-verified against the dev project (TST-12 integration): real sign-in →
  correct admin scope; wrong password rejected; hardened cookie issued.
- **Owner reality-gate:** the dev Supabase project must have email/password auth enabled and the
  keys present in `.env.local` (already set). Non-prod uses a separate project (SEC-07); prod keys
  are separate. The `proxy` fails closed in production if keys are missing.
