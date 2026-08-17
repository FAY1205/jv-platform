# WP-AUTH-OUTAGE — auth availability 503 + index-convention cleanup

Promoted from candidate **C-3** (carried from the WP-SU-16..20 line). Tier A (a prod index-rename migration).

## Goal

Three small auth-line follow-ups left as candidates after WP-SU-20:

1. **503 + Retry-After for an auth-backend outage (SEC-09 availability).** WP-SU-20 made the login
   route distinguish an infra fault (`signInWithPassword` threw → tri-state `undefined`) from a wrong
   credential, returning a floored 500 instead of a 401 masquerade. A transient, *retryable* outage
   is more honestly a **503 + Retry-After** than a 500 — it tells a client/monitor to back off and
   retry rather than reporting a hard error.
2. **`getSupabaseServer` outside the timing floor.** So the `withUniformTiming` floor wraps only the
   network auth call, not client construction.
3. **SU-18 index name convention.** Migration 0029 created `notice_claims_identifier_kind_key`; a
   plain `CREATE UNIQUE INDEX` should carry the `_idx` suffix (`_key` is Postgres's own suffix for a
   UNIQUE-CONSTRAINT-backed index, which this is not).

## Definition of done

- `jsonServiceUnavailable(code, message, detail?, retryAfterSec=5)` in `lib/http.ts` — 503 +
  `Retry-After`, logs with a shared traceId (mirrors `jsonServerError`), `Cache-Control: no-store`.
- The login route's `success === undefined` path returns `jsonServiceUnavailable("login_unavailable", …)`
  — still floored (the floor already ran around the throw) and account-independent (AUT-05-safe).
- **`change-password`'s sibling infra branch** (surfaced by the pr-reviewer, F-2) moves onto the same
  helper: its `ok === undefined` path previously returned a bare 503 with NO log and NO `Retry-After`
  (a silent failure on an authed path, ADR-0014). It now captures the throw and returns
  `jsonServiceUnavailable("password_change_unavailable", …)`, consistent with login.
- Migration **0048** renames the index in place (`ALTER INDEX … RENAME`, metadata-only, no
  drop-window on the uniqueness guard) + `schema.ts` updated; journal `when` above 0047.
- **(2) requires no code change** — verified: `login` and `change-password` construct the Supabase
  client *before* `withUniformTiming`, so the floor wraps only the auth network call. `otp/verify`
  DOES reach `getSupabaseServer` indirectly (via `establishSessionForEmail` → `getSupabaseServer` +
  `getSupabaseAdmin`), but INSIDE its floor BY DESIGN — session establishment is part of the timed
  outcome there, not client construction to be hoisted out. So nothing to move.

## Out of scope

- Extending 503 semantics to otp/verify's `session_failed`/catch-all (those are DB/session faults
  caught inside the floor, not the account-independent "auth backend unavailable" signal login
  isolates). Candidate if a distinct availability signal is ever wanted there.

## Tests

- `tests/unit/http.test.ts` — `jsonServiceUnavailable` returns 503 + Retry-After (default + custom) + no-store.
- `tests/unit/auth-route-observability.test.ts` — login infra fault now asserts **503** + `Retry-After: 5`
  (was 500), still logged, still not settled onto the lockout ladder.
- `tests/integration/notice-claims-retention.test.ts` + `auth-lockout-notify.test.ts` — green after the rename.
