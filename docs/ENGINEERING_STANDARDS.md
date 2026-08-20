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
- A predicate that decides **which users belong to the caller's stream/org** is a scope
  builder and lives in `src/lib/scope.ts` (`streamUsersWhere` / `sameStreamUsersWhere`) —
  not in the module that happens to need it first. It is the axis a row-visibility test
  cannot catch: a loosened arm widens *identity resolution* (whose email an assignee join
  may surface) and *assignee validation* without changing which rows come back, so no
  isolation probe fails. A module-local copy requires the `⚠️ SCOPE-GUARD-ADJACENT` marker
  and a named cross-reference to every sibling definition. (C-47; audit-tenancy F-1 on C-11.)
- The app's Postgres connection is the table owner ⇒ **RLS does not constrain app
  queries**. RLS (deny-by-default on every table) is the backstop for the PostgREST
  surface and non-app access. The scope builders are the primary boundary — treat a
  missed builder as a Critical defect, not a style issue.
- Service-role / `getSupabaseAdmin()` use requires: (a) a reason the scoped path can't
  work, (b) an explicit tenant filter, (c) an isolation test. Current footprint: 11
  files (as of 2026-08-05) — the authoritative list is
  `grep -rln "getSupabaseAdmin\|SERVICE_ROLE" src`, never a written count.
- New tables ship `tenant_id` + deny-by-default RLS policy + indexes in the same
  migration (SEAM-01, DM-11). Exceptions (pre-tenant auth tables like `auth_attempts`)
  are documented in an ADR (ADR-0010).
- `TODO(owner)`: evaluate `FORCE ROW LEVEL SECURITY` + a non-owner app role with
  session-GUC tenant pinning as defense-in-depth (target: before Phase 5 multi-tenant).
- Correlated child subqueries in a WHERE/ORDER BY/SELECT expression must carry their
  own tenant scope via `tenantWhere(childTable, scope)`, not rely solely on a
  correlation key. Defence-in-depth per ADR-0013 (no RLS): a single dropped predicate
  must not be able to widen scope. Conforming: the `lead_status_history` latest-status
  subqueries (portal + leads) and the latest-at subquery (leads) in
  `src/modules/portal/queries.ts` and `src/modules/leads/queries.ts` (WP-F1).

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
- `logError` is wired to Sentry (ACT-03, ADR-0032) with PII/secret scrubbing and cron
  check-in monitors (ACT-05) — best-effort failures are visible in production.

## 5. Database change discipline (DM-*, working rules)

- Every schema change = migration + seed + RLS policy + index **in the same PR**.
- Migrations are additive/expand-contract; destructive steps need explicit rollback
  notes in the WP. Drizzle schema and SQL migrations must not drift (`db:generate`
  produces nothing new).
- Soft-delete (`deleted_at`) is filtered in every read path (DM-09).
- **DM-11a — a new predicate against an append-only table ships with its index.** Tables
  that only ever grow and are never pruned (`audit_log` above all — SET-07's retention
  sweep deliberately does not touch it) have no natural ceiling, so a query shape that
  is instant on a demo tenant is a sequential scan at year three. A PR introducing a new
  WHERE shape against one either adds the covering index in the SAME PR (the standing
  "schema change = migration + index" rule, applied to the read side) or names a
  follow-up WP in the PR body — never neither. Adding the read and "watching it" is not
  an option: the regression arrives as a slow page months later, with nothing pointing
  back at the commit that caused it.
- Multi-write flows run in one transaction; advisory locks (`pg_advisory_xact_lock`)
  are taken first and in consistent order. Pooler constraints hold: `prepare: false`,
  xact-scoped locks only.
- Known open items: the dedupe partial-unique-index follow-up is **resolved by
  ADR-0038** (migration 0034 dropped uniqueness — same-dedupe-key rows are
  legitimate, do not re-flag). Retention sweep (SET-07) is now **complete** — the
  auth tables (`auth_attempts`, `otp_challenges`, `reset_tokens`,
  `signup_verifications`, `trusted_devices`, `notice_claims`) and, since WP-RET-2,
  the tenant-scoped operational tables (`idempotency_keys`, `email_outbox` terminal
  rows, `ai_feedback`) are all pruned by the daily retention cron. The `events`
  table was dropped by ADR-0020.

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
- Security headers are shipped (SEC-08): CSP, HSTS, `frame-ancestors`,
  `Referrer-Policy` and friends are defined centrally in
  `src/lib/security-headers.ts` and wired via `next.config.ts`.
- **AUTHZ-08 — audit_log content rides `ops.admin`.** Any surface that derives what it
  shows from `audit_log` rows is gated on `ops.admin` (ADMIN_LOCKED, ADR-0049 §11.3),
  or carries a recorded exception naming the DERIVED SUBSET and why it is safe. The
  human surface for the trail (`/api/activity`) already requires it, so a feature that
  re-derives the same rows behind a cheaper capability (`leads.read`, `ai.use`) becomes
  a bypass of the screen that refuses them — the AIS-11/C-45b lesson
  (`src/modules/ai/tools.ts`). Derivation is not exemption: a summary of a forbidden
  row is a read of it. Where the derived slice is genuinely thinner, gate
  conservatively and log the widening as an owner decision rather than assuming it.
  - **Recorded exception — names-only derived edit facts on the lead record timeline
    (owner decision 2026-08-20, WP-N5 PR D).** The `details_updated` entries in
    `getAdminLeadDetail` (`src/modules/leads/queries.ts` →
    `detailsUpdatedActivity`, `src/modules/leads/timeline.ts`) are LEAD-WORK data,
    not audit data, and ride `leads.read` — so every admin-stream tier
    (admin/member/viewer) receives them. The derived subset is **field NAMES, the
    actor, and the timestamp; never a value, before or after** (SEC-05), scoped to
    the ONE lead the caller already has open. That is what makes it safe: it tells a
    reader something about the lead they are entitled to read, not something about
    the tenant's trail. The exception does **not** widen `/api/activity`, the AIS-11
    assistant tool, or any tenant-wide / cross-entity / before-after surface — those
    stay on `ops.admin`. It does not extend to the PARTNER stream either:
    `detailsUpdatedActivity` throws on a partner scope, because `audit_log` has no
    partner predicate (PRN-13/R-22). Pinned by
    `tests/integration/lead-timeline.test.ts` ("N5-14/AUTHZ-08 exception"). Any new
    audit-derived surface starts gated and needs its own owner decision — this
    exception is not a precedent to reason from by analogy.

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
- A surface that switches records WITHOUT unmounting (a non-modal side panel whose subject
  changes in place, a master/detail pane, a carousel over records) ships a test asserting the
  PREVIOUS record's detail-only fields are ABSENT after the switch — not merely that the new
  record's fields are present. "The new lead is on screen" is satisfied by a surface still
  carrying the old seller's phone number beside it (PRN-08/PRN-13). Assert the absence on the
  frame the identity changes, not only after the new detail settles: the transient is where a
  later `keepPreviousData`-style smoothing puts one record's PII under another's title.
  Fixtures must therefore give each record DISTINCT values in those fields — a shared fixture
  value cannot tell "the new record's data" from "the old record's data, still rendered".
- **A write path whose correctness depends on browser focus semantics carries one
  Playwright case.** jsdom is provably insufficient for the class: it does not fire a
  blur when the focused element is removed, so any "commit on blur + unmount on commit"
  primitive behaves identically there with and without its double-fire guard — a green
  unit suite says nothing about the bug. `InlineField`'s `settled` latch is the worked
  example (`tests/e2e/admin-inline-edit.spec.ts` counts the PATCHes; the unit file names
  what it cannot see). The same applies to focus restoration, focus traps, and anything
  keyed on `document.activeElement` after an unmount. Assert the REQUEST count, not the
  rendered result — a duplicate write usually paints identically.
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
  e2e on main. Deployment (Vercel, push-to-main), the outbox-drain cron, and Sentry
  with cron check-in monitors (ACT-03/ACT-05, ADR-0032) are live.
  `TODO(owner)`: Lighthouse gate re-enable (FEP-08).
