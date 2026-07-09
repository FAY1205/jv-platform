# Engineering Standards — JV Platform (backend & platform)

Canonicalizes the implementation patterns this codebase already follows, so audits and
future code have one reference. **Authority order:** `docs/SPEC.md` (the contract) >
ADRs > this document > code comments. Conflicts with SPEC are bugs in this document.
Open decisions are marked `TODO(owner)` — they are the honest edges of the standard.

## 1. Route handler anatomy (API-01, PRN-08)

Every route in `src/app/api/**/route.ts` follows one shape, in order:

1. **Zod-parse** all input (body, params, query) — reject before any work.
2. **Resolve scope** via `getServerScope()` (`src/lib/scope-context.ts`) — JWT verified
   by Supabase (`getUser()`), scope built from the `users` row (the table is the source
   of truth, never raw JWT claims).
3. **Gate**: `requireAdminResponse` for admin surfaces; `assertCsrf` (Origin +
   double-submit token) for state-changing requests; login/OTP stay Origin-only pre-session.
4. **Delegate to a module** (`src/modules/*`) — routes hold no business logic.
5. **Uniform envelope**: errors are `{code, message, traceId}` via `src/lib/http.ts`;
   auth failures use `authErrorResponse` (uniform content + status).

Exemplars: `src/app/api/uploads/route.ts`, `src/app/api/admin/partners/route.ts`.

## 2. Tenancy & scoping (PRN-08, SEC-01 — see ADR-0013)

- Every Drizzle query in a request path builds its WHERE via `src/lib/scope.ts`
  builders: `tenantWhere` / `leadWhere` / `noteWhere` / `leadChildWhere`. Hand-rolled
  tenant filters are non-conforming even when correct.
- The app's Postgres connection is the table owner ⇒ **RLS does not constrain app
  queries**. RLS (deny-by-default on every table) is the backstop for the PostgREST
  surface and non-app access. The scope builders are the primary boundary — treat a
  missed builder as a Critical defect, not a style issue.
- Service-role / `getSupabaseAdmin()` use requires: (a) a reason the scoped path can't
  work, (b) an explicit tenant filter, (c) an isolation test.
- New tables ship `tenant_id` + deny-by-default RLS policy + indexes in the same
  migration (SEAM-01, DM-11). Exceptions (pre-tenant auth tables like `auth_attempts`)
  are documented in an ADR (ADR-0010).
- `TODO(owner)`: evaluate `FORCE ROW LEVEL SECURITY` + a non-owner app role with
  session-GUC tenant pinning as defense-in-depth (target: before Phase 5 multi-tenant).

## 3. Modules, purity, ports (PRN-01, §4)

- Pipeline steps (`src/modules/pipeline`) are pure: no DB, fetch, `Date.now()`,
  `Math.random()`, or env reads. Callers stamp timestamps.
- Persistence sits behind ports (`RunStore` in `src/modules/run`); transports are
  injected (`resolveOutboxTransport`), never constructed inline.
- Statistics come from `src/modules/analytics` only (PRN-15) — UI, emails, and future
  AI all call the same functions; a number computed elsewhere is a defect.
- `src/modules/*` never imports from `src/app`. Edge-executed code (`src/proxy.ts`)
  never imports `node:*` or `next/headers`-dependent modules (see the
  `csrf-token.ts` / `cookie-options.ts` splits).

## 4. Error handling & side effects (see ADR-0014)

- The transactional core of an upload is `processRun` + `persistRun` (one txn,
  advisory-lock first — ING-06). Everything after (export storage, digests, listing
  checks, notifications, drain) is **best-effort**: wrapped in try/catch, failures go
  to `logError` (`src/lib/observability.ts`), and never fail or roll back the run.
- No silent swallows: every catch either rethrows or calls `logError` with context.
- `TODO(owner)`: wire `logError` to Sentry (ACT-03) and add job heartbeat (ACT-05)
  before real weekly operation — console-only means best-effort failures are invisible.

## 5. Database change discipline (DM-*, working rules)

- Every schema change = migration + seed + RLS policy + index **in the same PR**.
- Migrations are additive/expand-contract; destructive steps need explicit rollback
  notes in the WP. Drizzle schema and SQL migrations must not drift (`db:generate`
  produces nothing new).
- Soft-delete (`deleted_at`) is filtered in every read path (DM-09).
- Multi-write flows run in one transaction; advisory locks (`pg_advisory_xact_lock`)
  are taken first and in consistent order. Pooler constraints hold: `prepare: false`,
  xact-scoped locks only.
- Known open items: `TODO(owner)` partial unique index
  `leads(tenant_id, dedupe_key) WHERE deleted_at IS NULL` (WP-018 follow-up);
  `TODO(owner)` retention sweep (SET-07) for `auth_attempts`, `email_outbox`,
  `events`, `audit_log` growth.

## 6. AuthN/Z patterns (AUT-*)

- Uniform responses + timing floors on every credential/identity endpoint (AUT-05,
  `withUniformTiming`); secrets compare via `timingSafeEqual` only
  (`src/lib/auth/constant-time.ts`, AUT-09).
- Cookies: `__Host-` prefix, HttpOnly, Secure, SameSite=Lax; tokens never in Web
  Storage (AUT-12). Session refresh in `src/proxy.ts`; protected routes redirect
  by audience (admin → `/login`, portal → `/portal/login`).
- Rate limiting/lockout via the Postgres `auth_attempts` store (ADR-0010); every new
  auth-adjacent endpoint wires a throttle config and returns 429 + Retry-After.
- Trusted-device / sessions are app-owned rotating refresh tokens with reuse-detection
  revoking the family (`src/lib/auth/trusted-device.ts`).
- `TODO(owner)`: security headers are absent — adopt CSP, HSTS, `frame-ancestors`,
  `Referrer-Policy` (proposed spec amendment SEC-08; see audit reports).

## 7. Email & files (SEC-02/03/05/06/07)

- Non-production can NEVER email a real address: transports resolve to the
  sink/dev-mailbox outside production-with-key (`src/lib/auth/notify.ts`,
  `src/modules/notify/*`). This is airtight by construction — keep it that way.
- Email/notification content: lead ref-IDs + city/state only; never seller PII (SEC-05).
- Exports: every user-originated cell sanitized against formula injection (SEC-06);
  buckets private; downloads via short-TTL signed URLs (SEC-02); upload guard enforces
  type/size/row caps (SEC-03).

## 8. Testing standards (§9, working rules)

- Tests ship WITH the code, named by requirement ID:
  `it("ASN-01: zip match beats state fallback")`.
- Integration suites self-skip cleanly without env; skip conditions live in
  `beforeAll`/gates, never in `describe`-body construction (the `export-storage`
  lesson). Cloud-pooler runs use `--no-file-parallelism`; CI's ephemeral Postgres runs parallel.
- The MLS corpus (`tests/fixtures/mls-corpus*`) grows BEFORE MLS logic changes
  (PRN-04); the golden (`tests/fixtures/investorfuse-week-golden.json`) is a semantic
  diff pinned to a rules hash — re-pins must be explained in the WP.
- `TODO(owner)`: coverage measurement (vitest v8 provider) with a near-100% threshold
  on `src/modules/pipeline`; TST-07 portal E2E (the known biggest gap); a PR-time
  Playwright smoke tier (e2e currently runs on main only).

## 9. Dependencies & tooling

- Boring code wins. No new dependency without an ADR (`docs/adr/`).
- `xlsx` is pinned to the patched SheetJS CDN build (ADR-0006) — update deliberately,
  never via blind bump. `TODO(owner)`: integrity pinning + `pnpm audit`/OSV scanning +
  Dependabot/Renovate + secret scanning in CI (see audit-devops reports).

## 10. Observability & operations

- Every request carries a `traceId` in its error envelope; `logError` is the single
  seam for failures (SEC-05: never log secrets or seller PII).
- CI: typecheck + lint + unit on every PR; integration vs ephemeral Postgres on merge;
  e2e on main. `TODO(owner)`: deployment config (Vercel), cron for outbox drain +
  ACT-05 heartbeat, Sentry (ACT-03), Lighthouse gate re-enable (FEP-08).
