# WS-10 — Pre-deploy gate (design)

- **Date:** 2026-07-10 · **Branch:** `ws-10/pre-deploy-gate` off `phase-2/distribution` (20530f4)
- **Spec:** REDESIGN-R3 §4 WS-10. **SPEC/audit refs:** F-06, F-07, F-42, F-43–47, F-86, F-04/TR-4, TST-07.
- **Companion ADR:** [ADR-0021 — observability & error correlation](../../adr/0021-observability-and-error-correlation.md).

The final gate before the first real partner. Independent hardening items, landed as
small reviewed slices. Owner decisions (this session): **defer the Sentry SDK** (do
traceId correlation now, ADR-0021); **build the hardening slices first, TST-07 last**
(it is CI/main-verified — can't run green locally).

Every slice: `tsc --noEmit` + `lint` + `test:unit` (+ `test:integration` self-skips
locally). Header/CSP/E2E behavior that needs a served build is CI/owner-verified.

## Slices

1. **Security headers / CSP (F-06).** New pure `src/lib/security-headers.ts`
   `securityHeaders()` builder → consumed by `next.config.ts` `headers()`. Enforcing:
   `Strict-Transport-Security` (2y, includeSubDomains, preload), `X-Content-Type-Options:
   nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
   `Permissions-Policy` (camera/mic/geo/payment off), and a CSP with `frame-ancestors
   'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `default-src
   'self'`, `connect-src 'self' <supabase>`, `img-src 'self' data:`. **Tradeoff:**
   `script-src`/`style-src` keep `'unsafe-inline'` (Next App Router injects inline
   bootstrap without nonce plumbing); nonce-based tightening is a flagged follow-up that
   needs a served build to verify. Unit test asserts the critical directives.

2. **Upload body sizing (F-86).** `POST /api/uploads` (+ `/confirm`) currently parse the
   full JSON body before the Zod row cap fires. Add `export const maxDuration` and a
   `Content-Length` ceiling check **before** `req.json()` (pure `src/lib/upload-guard.ts`
   `withinBodyLimit(contentLength)` + `MAX_UPLOAD_BODY_BYTES`), rejecting oversize
   payloads with the uniform envelope before a giant parse. Unit-tested.

3. **traceId correlation (F-42, ADR-0021).** `logError(code, detail, traceId?)` emits the
   id; handlers derive one `traceId` and pass it to both the envelope and `logError`.
   Start with the highest-value 500-path routes (uploads, leads edit/assign). Unit test
   the logError shape.

4. **ToS gate hardening (F-04 / TR-4).** ToS is enforced only on the `/portal` landing
   page; the portal DATA routes are ungated. Add a `requireTosResponse(scope)` guard
   (mirrors `requireAdminResponse`) that partner data routes call, returning a uniform
   `tos_required` envelope when the partner's latest acceptance ≠ `CURRENT_TOS_VERSION`.
   Integration-tested (accepted vs stale-version partner).

5. **CI hardening (F-43–47).** `.github/dependabot.yml` (npm + github-actions); `gitleaks`
   + `codeql` workflows; SHA-pin the actions in `ci.yml` (verified via `git ls-remote`);
   explicit least-privilege `permissions:` on every workflow. **F-46 note:** the audit's
   named vulns (postcss, exceljs>uuid) were ALREADY resolved before WS-10 (`pnpm-lock.yaml`
   carries `postcss@<8.5.10`/`uuid@<11.1.1` overrides on `phase-2/distribution`) — this WP
   doesn't touch the lockfile. The one remaining moderate (dev-only `esbuild<0.24.3` under
   drizzle-kit's deprecated `@esbuild-kit`) is left to a reviewable Dependabot PR rather
   than a blind override that can't be verified locally and could break `db:migrate` in CI.

6. **Outbox cron + heartbeat (F-07).** `vercel.json` `crons` calling the existing
   `POST /api/admin/outbox/drain` on a schedule + a lightweight heartbeat/health route.
   The drain endpoint already exists (WS-7); this wires the scheduler + documents the
   `CRON_SECRET` auth for it.

7. **TST-07 portal E2E (last, CI/main-verified).** `tests/e2e/portal-journey.spec.ts`:
   invite → OTP (dev mailbox) → ToS accept → leads list → status update → note → export,
   against a seeded tenant. Provision the `e2e` CI job with a Postgres service + migrate
   + seed + env (the job currently has none). Playwright is already a dependency and the
   `e2e` job runs on `main` only — so this is written now, validated in CI on the main
   merge, not locally.

## Owner reality-gate items (NOT code — flagged, not built)

- Real ToS/Privacy text (replaces `src/lib/legal/tos.ts` placeholder).
- Sending-domain SPF/DKIM/DMARC; verified `EMAIL_FROM` identity.
- US **production** Supabase project + Pro/PITR + a restore rehearsal.
- Subprocessor list / security page.
- `main` branch protection (required checks, no direct pushes).
- Sentry DSN/account (then wire the SDK behind `logError`, ADR-0021).
- **Vercel plan/env**: the `*/5` outbox cron needs sub-daily crons (Vercel **Pro**;
  Hobby caps at once/day) — confirm the plan or run an external pinger against
  `/api/cron/drain-outbox` with the bearer. Set `CRON_SECRET` (cron auth) and confirm the
  function `maxDuration` ceiling for the plan. To activate TST-07 in CI, provide a dev
  Supabase Auth project + dev-mailbox OTP + a seeded partner and set `E2E_AUTH_READY=1`.

## Invariants honored

- **PRN-08** scope.ts — the ToS guard reads the caller's own acceptance via scope; no
  new unscoped query. **SEC-05** — traceId/logError carry no secrets/PII. **AUT** — the
  ToS gate augments, never weakens, the existing auth/CSRF guards. No new runtime deps
  (Sentry deferred; Playwright already present). Uniform `{code,message,traceId}`
  envelope preserved for every new rejection.
