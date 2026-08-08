# ADR-0043: Capture and harden the RLS-auto-enable event trigger

- **Status:** Accepted
- **Date:** 2026-08-08
- **Phase / WP:** process (DB hardening — Supabase advisor sweep)

## Context

A Supabase security advisor flagged `public.rls_auto_enable()` — a `SECURITY DEFINER`
event-trigger function (backing the `ensure_rls` trigger) that enables row level security on
every new `public` table — as executable by `PUBLIC` (advisors 0028/0029), and its
`search_path` as mutable (advisor 0011, already resolved on the live object).

Investigation found the function + trigger existed in **prod only**, created out-of-band via the
Supabase SQL editor: absent from the repo, from version control, and from the `jv-platform-test`
project. That is drift around a **tenant-isolation** control — exactly the class the spec's
scoping rules (SCP-01, SEC-01, PRN-08) exist to protect. The mechanism is redundant with the
explicit per-table `enable row level security` in migration 0001, but redundant defense on the
worst failure mode (a future table shipped without RLS → cross-tenant read) is worth keeping —
just not as invisible drift. Doing nothing leaves an undocumented `SECURITY DEFINER` function
reachable at `/rest/v1/rpc` by `anon`/`authenticated`.

## Decision

Bring the mechanism under drizzle and harden it, in migration `0039_capture_rls_auto_enable`:

- **Capture** `rls_auto_enable()` (`CREATE OR REPLACE`, `search_path` pinned to `pg_catalog`) and
  the `ensure_rls` event trigger (`DROP ... IF EXISTS` + `CREATE`) verbatim from prod, so every
  environment — prod, test, CI's ephemeral Postgres — matches and code review can see it.
- **Revoke** `EXECUTE ... FROM PUBLIC`. The trigger still fires (it runs as its owner, not the
  caller), so behavior is unchanged; only the RPC surface closes. `postgres` (owner) keeps execute.
- Applied through the migrate-on-deploy pipeline (ADR — build step). Verified the `postgres` role
  (what `drizzle-kit migrate` runs as on prod, non-superuser) can create event triggers on
  Supabase via a rolled-back probe, and validated the migration SQL the same way, before merge.

Alternatives considered:
- **Drop it entirely** — rejected: it is cheap insurance against a forgotten RLS-enable, and
  dropping a control whose full call-history we did not own is riskier than keeping it.
- **Just `REVOKE` on prod, leave it undocumented** — rejected: clears the advisor but preserves
  the drift (test DB still lacks it; not in version control).

## Consequences

- The RLS-auto-enable net is now version-controlled, present in the test DB, and enforced in CI.
  A new table added by any future migration still gets RLS auto-enabled (belt-and-suspenders with
  the explicit 0001 enables).
- The `pr-reviewer` Sentry/observability import rule is unaffected; this is a DB object, not code.
- Event triggers require elevated privilege to create; this migration is proven to work as the
  `postgres` role on Supabase, but a future environment on a role without that grant would fail at
  `CREATE EVENT TRIGGER`. That is acceptable (all environments use the same Supabase role model).
- Follow-up (dev WP candidate): the other Supabase advisor items from the same sweep remain —
  `function_search_path_mutable` on the `app_current_*` scope helpers + `reject_audit_log_mutation`,
  and `auth_leaked_password_protection` (likely N/A — the app runs its own HIBP check per ADR-0040).
- Not addressed here: `jv-platform-test` schema parity is still refreshed manually (`db:migrate`
  against the test project); CI validates on ephemeral Postgres, not the test project.
