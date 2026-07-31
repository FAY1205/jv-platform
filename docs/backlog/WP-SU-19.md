# WP-SU-19: auth-surface observability parity (SEC-05 / ADR-0032)
Spec: SEC-05 (§6.18) · ADR-0032 (Sentry seam) · AUT-05 (§6.18) · Phase: 2 · Tier: A · Depends: WP-SU-10 (onRequestError), WP-SU-17 (otp/verify catch pattern)

## Problem (verified 2026-07-31 against phase-2/distribution @ 7c5ddeb)
`withUniformTiming` (`src/lib/auth/enumeration.ts:30-38`) runs its `work` callback inside a
`try { … } catch { result = undefined }` — it **swallows any throw** into the timing floor and
returns `undefined`. Three routes run their side-effecting work inside it and have **no inner catch**:

- `src/app/api/auth/login/route.ts` — `work` = `supabase.auth.signInWithPassword(...)`.
- `src/app/api/auth/otp/request/route.ts` — `work` = settle + user lookup + `notifyOtp`.
- `src/app/api/auth/reset/request/route.ts` — `work` = settle + user lookup + `notifyReset`.

So an infra fault inside `work` — a DB fault, or (most likely in production) **the email transport
throwing on a misconfigured Resend key** — is completely invisible: no `logError`, no Sentry event,
and because the throw never propagates out of the handler, WP-SU-10's `onRequestError` never fires
either. `otp/request`/`reset/request` even return their uniform *success* response ("if an account
exists, we've sent a code") over the top of a send that never happened. This is exactly the failure
class that surfaces on day one of the production deployment, when these routes first point at a real
email provider — and today it fails silently with zero trace.

WP-SU-17 fixed the same swallow for `otp/verify`; this is the parity fix pr-reviewer flagged there
(WP-SU-17 F-2) for the remaining three routes.

## Design — capture, then rethrow (no behaviour change)
One idiom in each `work` callback:
```ts
try {
  …existing work body…
} catch (e) {
  logError("<route>_infra_failed", { message: e instanceof Error ? e.message : String(e) });
  throw e; // rethrow — withUniformTiming still floors timing; the route's response is unchanged
}
```
`logError` (`src/lib/observability.ts`) scrubs `detail` (SEC-05, WP-SU-3) and forwards to Sentry
(`captureMessage`, gated on `SENTRY_DSN`) as well as the console — so this lights up in production and
stays inert in dev/test/CI. Rethrowing preserves the existing swallow, so responses are
**byte-identical**: `otp/request`/`reset/request` stay uniform `200`, `login` stays `401`.

**Why log-only, not a 500 (unlike WP-SU-17's otp/verify):** on `otp/request`/`reset/request` the
send only runs for an account that exists, so surfacing a distinct error status on a send-failure
would leak account existence and break AUT-05. `otp/verify` could return a generic 500 because its
throw is account-independent; these two cannot. So here the fix is purely the capture.

Log codes: `login_infra_failed`, `otp_request_failed`, `reset_request_failed`.

## Out of scope → WP candidate (owner decision)
`login`'s deeper behaviour: an infra fault is currently treated as a *failed credential* — it feeds
the AUT-04 lockout ladder (so a transient Supabase outage could lock out a legitimate admin after 5
retries) and returns `401` rather than a `500`. Login's throw *is* account-independent, so returning
a floored 500 there would be AUT-05-safe and more honest — but it's a behaviour change (response +
lockout semantics), so it belongs in its own WP with an explicit owner decision. This WP adds only
observability; it does not change that behaviour.

## Definition of done
- [x] `login`, `otp/request`, `reset/request` each capture a `work`-body throw via `logError` before
      it is swallowed, then rethrow — response and timing unchanged.
- [x] Log codes carry no PII (message routed through the scrub seam; SEC-05).
- [x] TDD: 6 tests (`tests/unit/auth-route-observability.test.ts`), real red→green — the 3 fault
      cases asserted `logError` called 0× before the change (status already uniform), pass after; 3
      happy-path guards assert the catch does not fire spuriously.
- [x] No schema change, no new dependency, no ADR needed (reuses the existing seam).
- [x] Regression: auth route integration suites green (isolated, per the pooler constraint).
- [x] Reviews: pr-reviewer + audit-security — findings folded or documented.
- [ ] Owner walkthrough. No commit until owner go; no push until owner go.

## Tests (TDD — names carry AUT-05/ADR-0032; fully mocked, no DB, pooler-free)
`tests/unit/auth-route-observability.test.ts` mocks the collaborators (assertCsrf, AuthAttemptsStore,
getDb, getSupabaseServer, observability) and drives the real route handlers:
- infra fault in otp/request → `logError("otp_request_failed", …)` AND response still `200`.
- infra fault in reset/request → `logError("reset_request_failed", …)` AND response still `200`.
- infra fault in login → `logError("login_infra_failed", …)` AND response still `401` (no 500 leak).
- healthy otp/request, reset/request, login → `logError` NOT called (non-spurious).

## Notes / risks
- Land on `claude/wp-su-19` (worktree off 7c5ddeb), then fast-forward into `phase-2/distribution`.
- Before any commit: `git diff --cached --name-only` must NOT include `PRODUCT_BRIEF.md`,
  `WEBSITE-BRIEF.md`, or `docs/legal/`.
