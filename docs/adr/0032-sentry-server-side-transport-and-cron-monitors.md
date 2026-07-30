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
- **When a later, unrelated pass is bolted onto an existing monitored cron** (as WP-SU-11's
  `auth_attempts` prune was added to the retention-sweep route), the rule is: **a pass fails the
  monitor check-in only if it IS, or is part of, the reason that monitor exists.** The
  retention-sweep monitor exists to answer "did the LGL-02 consumer-PII purge run", so a
  data-minimisation hygiene pass added later must NOT be able to fail it — failing would raise a
  legal-grade alarm for a hygiene problem and report a purge that *did* run as failed. Such a pass
  stays best-effort behind its OWN dedicated `logError` alert code, on the condition that the code
  is enumerated in the Consequences list below and the owner wires a Sentry rule for it. (Contrast
  `reconcileDroppedSignups` on the signup-sweep cron, which DOES throw to fail its check-in —
  because dropped-signup reconciliation is part of that monitor's core promise, not a bolt-on.)
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
  WP-SU-8 adds two more. `already_registered_mail_capped` — a recipient hit the 3/24h cap on
  the victim-directed "you already have an account" mail; one or two is noise, a burst means
  someone is probing a known address. `signup_alert_suppressed_duplicate` — a surge/ceiling
  alert was suppressed by its 1/hour cooldown, i.e. the condition is STILL holding; treat a run
  of these as "the incident is ongoing", not as an error. SEC-05: neither code carries a
  recipient. Three failure codes accompany them and should ALL alert, because each one means a
  safety property silently stopped being enforced: `already_registered_cap_failed` and
  `signup_alert_cooldown_failed` (a budget check itself failed, so the guarded mail was
  suppressed fail-closed), and `notify_anomaly_no_recipients` (**ADMIN_ALLOWLIST is empty — the
  auth alert channel is dead**; this one is a configuration error, not a runtime blip, and it
  applies to the login anomaly alert too). Also `already_registered_notice_failed` /
  `signup_surge_alert_failed` from the route's `after()` guards.
  WP-SU-11 adds one: `cron_auth_attempts_sweep_failed` — the `auth_attempts` retention pass hung
  off the daily retention sweep (ADR-0010) threw. It is caught rather than propagated, on purpose:
  this monitor's check-in answers "did the LGL-02 consumer-PII purge run", and failing it for a
  data-minimisation pass would both raise a legal-grade alarm for a hygiene problem and mark a
  purge that DID run as failed. So the check-in stays green and **this code is the only signal** —
  alert on it, or `auth_attempts` silently resumes growing unbounded with third-party emails and
  IPs in it, which is the state ADR-0010 deferred and WP-SU-11 closed. A healthy run is silent;
  the rows-deleted count rides in the route's 200 response, not in a log line.
  WP-SU-13 adds three more of the same class — `cron_otp_challenges_sweep_failed`,
  `cron_reset_tokens_sweep_failed`, `cron_signup_verifications_sweep_failed` — the auth SIBLING-table
  retention passes hung off this daily sweep. Each is caught, not propagated, for the identical reason
  as `cron_auth_attempts_sweep_failed`: this monitor answers "did the LGL-02 consumer-PII purge run",
  so a data-minimisation hygiene failure must not fail its check-in. A healthy run is silent; the
  rows-deleted counts ride in the 200 response. Alert on all three, or these tables silently resume
  growing with raw third-party emails (otp_challenges) and token hashes in them. WP-SU-13 also
  right-sizes the auth_attempts `signup_notice` cutoff (F-3): those rows now drain at ~8 days, not
  ~31 — no new code path, the same `cron_auth_attempts_sweep_failed` covers a failure. (trusted_devices
  was in WP-SU-13's original scope but was pulled: naive age-pruning narrows AUT-10 reuse detection —
  it needs family-liveness-aware pruning in a dedicated WP. So no `cron_trusted_devices_sweep_failed`
  code is wired yet.)
- **Client-side errors remain unreported.** Accepted trade, stated plainly so it is not
  mistaken for an oversight. **Reopening this requires a follow-up ADR that first defines
  a PII scrubbing policy** (`beforeSend`) — never a default wizard install, which is the
  exact path that would breach ADR-0031.

### Amendment (WP-SU-10, 2026-07-30): `onRequestError` wiring

`src/instrumentation.ts` originally exported only `register`, so `Sentry.init`'s global
uncaught-exception / unhandled-rejection handlers were the only route to Sentry — and errors
thrown out of an **App Router route handler, server component render, or server action** are
caught by Next's framework and never reach those handlers, so they reached **no sink of ours**
(`logError` only sees the errors we catch ourselves). WP-SU-10 exports `onRequestError`, the
hook Next calls for exactly those errors, delegating to `Sentry.captureRequestError`
(verified present in both the server and edge builds of `@sentry/nextjs` 10.65). It is gated on
`SENTRY_DSN` and never throws, mirroring `register`.

That hook introduced **one new PII path, now closed**: `captureRequestError` writes the request
path into `contexts.nextjs.request_path` — a *context*, not `event.request.url`, so the existing
query-strip missed it — and reset / signup-verify links carry a live single-use token in the
query. `beforeSend` now strips and scrubs that context too.

A review pass (audit-security F-1) additionally found that `captureRequestError` sets
`event.transaction` to `${method} ${routePath}`; it is scrubbed as defense-in-depth even though
`routePath` is a compile-time route *template* today (no live value), on the same "scrub every
string field, don't trust a framework not to change" doctrine as the rest of `beforeSend`. And
`onRequestError`'s own catch (pr-reviewer F-1) leaves one first-party `console.error` code —
`sentry_capture_request_error_failed`, no PII — if the SDK call itself throws, so a transport
failure is never fully silent.

**Still residual, unchanged:** uncaught errors *printed* by Next/Node reach the hosting
provider's log store before any of our code runs — the one path `beforeSend` and WP-SU-3's
redaction cannot cover. No in-app hook closes it; it is bounded by choosing a host whose log
retention we accept.
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

### Amended by WP-SU-3 (2026-07-17) — caller `detail` is scrubbed at the seam

This ADR states that `beforeSend` and `dataCollection` are the enforcement point, "never
the caller contract alone." Those two controls govern what the **SDK collects on its own**
— they do not touch what a caller passes as `detail`, which becomes the event's `extra`.
That left one uncovered path, and it is the busiest: 29 of the 40 `logError` call sites
pass `{ message: e.message }`, a string this codebase does not author (Postgres embeds the
offending literal in constraint errors; providers echo recipient addresses).

WP-SU-3 adds a third control — `detail` is scrubbed in `observability.ts` before it is
handed to `captureMessage`. Recorded here because two implementation choices were
security-relevant and are not obvious from the plan text:

- **Markers are typed** (`[redacted-email]` / `[redacted-token]`) rather than a single
  `[redacted]`, so triage can tell what class of value was removed.
- **UUID-shaped runs are exempt** from the token pattern. A UUID is also a 24+ character
  run, and `traceId` / `tenantId` / `userId` are precisely what this seam exists to
  correlate — blind redaction would destroy F-42 while protecting nothing. Verified safe:
  real secrets in this repo (`randomBytes(32).toString("base64url")` reset/signup/refresh
  tokens) never take the hyphenated UUID shape.
- **BOTH sinks are scrubbed.** The first draft of this WP redacted only the Sentry payload
  and left the console line verbatim, on the theory that stdout is first-party. Review
  refuted that on three counts, and the owner overrode the original plan accordingly:
  SEC-05 says "excluded from **logs**" without qualification; the hosting provider retains
  stdout and is a subprocessor exactly as Sentry is; and, decisively, Sentry's
  `consoleIntegration` is **default-on** and attaches raw `console.*` arguments as a
  breadcrumb — so an unscrubbed console line was being re-delivered to Sentry on the very
  event whose `extra` had just been redacted, making the redaction cosmetic. That
  integration is now filtered out of the defaults as well.
- **The scrub runs at `beforeSend`, not only at the seam.** This ADR already said the seam
  is a convenience and `beforeSend` is the enforcement point; the first draft nonetheless
  put the control at the seam. Global uncaught-exception and unhandled-rejection handlers
  never pass through `logError`, so `beforeSend` now scrubs `extra`, `message`,
  `exception.values[].value` and `breadcrumbs`. The seam still scrubs too, as defence in
  depth and because the console line needs it before it is ever written.
- **Patterns cover what the code actually emits, not what we assumed.** Drizzle wraps every
  failed query as `Failed query: <sql>\nparams: <every bound parameter>` — for the batched
  lead insert that is every seller name, phone, address and raw row — so such a message is
  replaced wholesale, and phone numbers are redacted (SEC-05 names seller phone; the
  original email-only pattern set caught one field of the leak). Accepted trade: a bare
  10-digit epoch is indistinguishable from a bare 10-digit phone and is redacted too.
- **A THIRD SDK quirk, of the same shape as the two above: `dataCollection.httpBodies` does
  not stop incoming request bodies.** `requestdata.js` hardcodes `include.data = true`
  ("httpBodies gates write-time, not read-time"), and the write-time gate is actually
  `maxRequestBodySize`, which defaults to capturing 10KB of every request. So the login
  password, the OTP code, the live reset token and the first 10KB of a lead upload were
  riding on any event raised during those requests — on the very events whose `extra` was
  being carefully redacted. Fixed at both ends: the HTTP integration is re-registered with
  `maxIncomingRequestBodySize: "none"`, and `beforeSend` deletes `request.data` anyway.
  Integration names are read from the SDK (`Sentry.consoleIntegration().name`) rather than
  hardcoded, so an upstream rename cannot silently re-enable either ingestion path.
- **Redaction is entropy-aware, not length-based.** A pure `{24,}` rule matched 17 of this
  repo's own `logError` codes — every cron and signup alert — which Sentry would have
  grouped into a single untriageable issue, destroying the alerting this ADR bought.
  Structured identifiers (alphabetic words joined by `_`/`-`) are exempt; real secrets
  carry digits mixed into the run and never take that shape.
- **Redaction never reduces the payload.** Colliding scrubbed keys are disambiguated rather
  than overwriting each other, and `Map`/`Set`/binary values render instead of silently
  flattening to `{}`.
- **Strings are clamped before any regex runs.** The original unbounded email pattern was
  quadratic — measured 1.7s on 50KB and 78s on 200KB — and the Drizzle message above can
  reach megabytes, so the scrub itself would have become a denial-of-service on the request
  path. Quantifiers are now bounded and input is clamped (CWE-1333).
- **Fails closed twice:** past the recursion depth cap a subtree becomes `[truncated]`
  rather than being emitted unvisited, and a throw inside the scrubber replaces the entire
  payload with `{ scrub_failed: true }` rather than falling back to the raw object.
