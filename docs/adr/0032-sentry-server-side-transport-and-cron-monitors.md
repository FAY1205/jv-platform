# ADR-0032: Sentry as server-side error transport behind `logError`, plus cron monitors

- **Status:** Accepted (owner-approved, Phase A go-live session, 2026-07-16)
- **Date:** 2026-07-16
- **Phase / WP:** Phase A (Go Live) · WP-GL-D (Sentry wiring)
- **Amends:** ADR-0021 (observability seam — decision point 3 only; points 1 and 2 stand)

## Context

ADR-0021 built the observability seam and **deliberately deferred Sentry**: the SDK is a
new dependency and needs a DSN, an owner reality-gate item. It recorded the deferral so
the gap would be intentional rather than forgotten, and predicted that wiring Sentry
"is a single change inside `logError` (and an instrumentation file)". That prediction
holds — verified this session:

- `src/lib/observability.ts` `logError(code, detail, traceId)` is a 9-line, never-throws
  function and the single error chokepoint. It is PII-free **by contract** (SEC-05:
  callers must pass identifiers, messages, IPs, counts — never secrets or seller PII).
- It already carries the request `traceId` that matches the `{code, message, traceId}`
  error envelope (ADR-0021 F-42), so a user-reported trace maps 1:1 to a Sentry event.
- `SENTRY_DSN` is already typed in `src/lib/env.ts` as an optional string. A repo-wide
  grep confirms **nothing consumes it** — exactly the state ADR-0021 described.

Two forces reopen the deferral now, at the Phase A go-live gate:

1. **Prod errors are invisible.** `logError` is `console.error`-only. Once real partners
   are on the app, a server error is a log line nobody reads (F-07).
2. **The scheduled jobs became load-bearing, and their failure mode is silence.**
   `vercel.json` schedules `drain-outbox` (`*/5`) and `retention-sweep` (`0 3 * * *`).
   Since ADR-0021 was written, those jobs acquired two new duties: `drain-outbox` runs
   `releaseDueImports` (ADR-0026's 10-minute distribution hold) and `retention-sweep`
   runs the consumer-PII purge (ADR-0025 / LGL-02). If the scheduler silently stops,
   held imports never release **and consumer PII is never purged** — a standing
   legal exposure, not a missed digest. There is no error to alert on, because nothing
   ran. Grep confirms **no heartbeat emit exists** in either route.
   `/api/health` is liveness-only (no auth, no DB): an external watchdog on it proves
   the site is up, which is a different and independent signal from "the jobs ran."

Spec §ACT-05 ("every cron job emits a heartbeat; a dead-man's-switch alert fires if a
job misses its schedule ... an external uptime monitor watches the app") is formally a
Phase-3 line item (§421). The alert half is pulled forward here **only because it is
nearly free once Sentry is present** (`Sentry.withMonitor`); the uptime half stays the
owner's external watchdog on `/api/health`, unchanged.

## Decision

**Un-defer Sentry. Approve `@sentry/nextjs`. Wire it server-side only, behind the
`logError` seam, and use its cron monitors to close ACT-05's dead-man half.**

- **Dependency:** `@sentry/nextjs` (CLAUDE.md: no new dependency without an ADR).
  Rejected `@sentry/node`: `@sentry/nextjs` is the supported path for the Next.js
  server runtime + Vercel, and owns the `instrumentation.ts` register hook.
- **Server-only, and deliberately so.** A single `src/instrumentation.ts` whose
  `register()` branches on `NEXT_RUNTIME` (nodejs/edge) and calls `Sentry.init` — the
  documented manual-setup pattern, and one file that a unit test can drive. **Do not
  create the client config** (`instrumentation-client.ts` / `sentry.client.config.ts`) —
  the browser SDK is a separate opt-in file, so omitting it is what keeps Sentry off the
  client. No browser tracing, **no session replay**. `next.config.ts` is deliberately not
  wrapped with `withSentryConfig`, so the bundler plugin never runs.
- **Sentry's automatic enrichment is pinned off, not trusted to defaults.** Keeping PII
  out of what we *send* is necessary but NOT sufficient: the SDK attaches its own context,
  and several of those default to ON. Each is a leak on this app, so `init` sets
  `dataCollection: { userInfo: false, cookies: false, httpHeaders: {request:false,
  response:false}, httpBodies: [], queryParams: false, stackFrameVariables: false }` —
  respectively the `__Host-` session cookie (AUT-12), the `Authorization: Bearer
  CRON_SECRET`, raw lead-upload bodies, and **stack-frame local variables**, which in an
  `editLead` frame hold the seller's name and phone.
  Two SDK quirks are pinned around, both found by reading `@sentry/core`'s source rather
  than its docs: `dataCollection.stackFrameVariables` is **resolved but never read** in
  v10 (the local-variables integration gates on `includeLocalVariables`, so that is set
  too, and the `dataCollection` key is kept for v11); and `genAI` **defaults to
  `{inputs:true, outputs:true}` as soon as `dataCollection` is provided at all**, which
  matters because this repo runs an AI assistant (ADR-0027) — it is inert only while
  `tracesSampleRate` is 0, so it is pinned off rather than left to that coincidence.
- **Transport lives inside `logError` — but `logError` is NOT the boundary.** Our own
  sends go through the seam: call sites do not change and do not import Sentry, and
  `logError`'s never-throws contract is preserved (a Sentry failure — init, network,
  quota — must never alter control flow, so the send sits in its own `try`). However
  `Sentry.init()` additionally installs global `onUncaughtException`,
  `onUnhandledRejection` and `consoleIntegration` handlers, which capture events that
  **never pass through `logError`** and therefore sit outside its SEC-05 caller contract.
  The seam is a convenience; **`beforeSend` is the enforcement point**, and PII controls
  belong there and in `dataCollection` — never in the caller contract alone.
- **`beforeSend` strips every query string from `event.request.url` (SEC-05).** The SDK
  attaches the request URL unconditionally — `dataCollection` has no key for it, so
  `queryParams: false` does not cover it. We email password-reset links as
  `/reset?token=<live 30-minute token>` (`api/auth/reset/request`), so an error during
  that request would ship an account-takeover credential to a third party. Stripping the
  whole query string is blunt, costs us nothing we need, and covers future params.
- **`SENTRY_DSN` remains the activation switch.** Unset ⇒ Sentry sends nothing (SDK
  behavior: no DSN, no transmission) and `logError` stays console-only — today's exact
  behavior. **No env-schema change.** This keeps dev/test/CI silent by default (SEC-07).
- **Cron monitors (ACT-05, alert half).** Wrap each cron handler's work in
  `Sentry.withMonitor(slug, fn, monitorConfig)`, declaring the schedule in code
  (`*/5 * * * *` and `0 3 * * *`) so the monitor definition cannot drift from
  `vercel.json` — a drift test asserts that both ways. Sentry then alerts on missed,
  failed, or over-running jobs.
- **A totally failed run must throw, not return a 500.** `withMonitor` finishes a
  check-in `"ok"` whenever its callback **resolves**, and never inspects the resolved
  value. Both routes previously caught a tenant-list failure and returned an error
  response — which would have reported a run that purged nothing as *healthy*, a green
  dashboard over an undischarged LGL-02 promise, i.e. the exact false confidence this ADR
  set out to remove. So the total-failure path propagates out of the `withMonitor`
  callback and is caught outside it, preserving the `{code,message,traceId}` envelope.
  Per-tenant failures stay best-effort and swallowed (ADR-0014): the job *did* run.
- **Residency: the DSN must be a US-region Sentry project**, consistent with ADR-0003's
  US data-residency decision for Supabase.
- **Sentry is a new subprocessor** and must appear on the subprocessor/security page
  before real partners are onboarded (owner deliverable, go-live Gate 2).

Rejected — **full SDK including the browser client.** It would catch client-side React
errors that `global-error.tsx` cannot currently report, but its defaults ship
breadcrumbs, URLs, and potentially form values to a third party. That would put consumer
PII in a US vendor's store — precisely what ADR-0031 (merged two commits before this ADR
was written) exists to prevent, and what SEC-05 forbids. Not worth the trade at go-live.

Rejected — **an external dead-man's-switch service** (e.g. healthchecks.io). Equivalent
capability, but a second vendor, a second subprocessor, a new env var, and a ping call in
each cron route — to buy something the already-approved Sentry does natively.

Rejected — **deferring again** (ADR-0021's choice, re-examined). Defensible while the
crons only sent digests; not defensible now that they carry the LGL-02 PII purge and the
ADR-0026 hold release, whose failure mode is silent and legal.

## Consequences

- **What this closes:** F-07's error-transport facet; ACT-05's dead-man's-switch half.
  ADR-0021's points 1 and 2 (one traceId per request, `logError`'s optional `traceId`)
  are untouched and now pay off — the traceId lands in Sentry.
- **What stays open:** ACT-05's uptime half (owner's external watchdog on `/api/health`,
  ~10 min, needs the prod URL). Sentry alert *rules* are configured in the Sentry UI, not
  in code — an owner step once the DSN exists. Two rules are needed, not one: the **cron
  monitors** cover missed/failed/stuck runs, but a run where *some* tenants fail stays
  best-effort and surfaces only as `logError` error events — so also alert on the codes
  `cron_drain_failed`, `cron_retention_failed`, `cron_release_tenant_failed`,
  `cron_drain_tenant_failed`, `cron_retention_tenant_failed`.
  WP-SU-2 (signup-sweep) adds the same class of codes: `cron_signup_sweep_failed`,
  `cron_signup_sweep_tenant_failed`, and `cron_signup_sweep_tenant_fk_blocked` (a tenant
  purge blocked by an unexpected residual row — a distinct, actionable stop). It also adds
  three `logError` **success** signals — `signup_orphan_reconciled`,
  `signup_partial_provision_reconciled`, and `signup_orphan_reconcile_paging_truncated` —
  which are the "abandoned/dropped signups are accumulating (or exceed one run's paging
  bound)" alerts WP-SU-2 exists to raise: a healthy sweep is silent, so a non-zero count
  here is the signal, not an error. Alert on all six.
- **Client-side errors remain unreported.** Accepted trade, stated plainly so it is not
  mistaken for an oversight. **Reopening this requires a follow-up ADR that first defines
  a PII scrubbing policy** (`beforeSend`) — never a default wizard install, which is the
  exact path that would breach ADR-0031.
- **Owner deliverables created (both Gate 2, neither blocking this code):** a US-region
  Sentry DSN, and Sentry added to the subprocessor page. Until the DSN is set, the wiring
  ships inert and behaves exactly as today — so this WP can land, be reviewed, and merge
  with no DSN in hand.
- **Cost/size:** server-only, so no client bundle impact; `@sentry/nextjs` does add a
  build-time webpack plugin (source maps). `tracesSampleRate` stays low in production —
  this ADR buys **error transport**, not APM.
- **Reopens if:** we adopt full request tracing (ADR-0021 already scoped OpenTelemetry
  out), or client-side visibility becomes necessary (see above).
- **Audit hooks:** `audit-security` verifies no PII reaches the transport and that the
  DSN is never logged; `audit-devops` verifies env separation (silent without a DSN) and
  that the monitor schedules match `vercel.json`; `pr-reviewer` flags any Sentry import
  outside `observability.ts`, the instrumentation files, and the two cron routes.
