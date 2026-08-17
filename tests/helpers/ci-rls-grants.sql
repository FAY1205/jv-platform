-- C-30: provision the Supabase grant baseline on a VANILLA Postgres (the CI integration
-- service container) so the RLS ENFORCEMENT oracle (rls-behaviour / rls-parity / rls-grants)
-- can run there instead of self-skipping. Applied AFTER `db:migrate`, which has already
-- created the `anon`/`authenticated` roles (migration 0044) and run the 0045/0046 DML revokes.
--
-- Supabase auto-grants FULL DML+SELECT to anon/authenticated on every table (its default ACL),
-- then migrations 0045/0046 REVOKE insert/update/delete — leaving SELECT retained, DML revoked.
-- A vanilla Postgres starts the custom roles with NO grants, so the revokes are no-ops and only
-- the SELECT half is missing. This grants exactly that missing half, reproducing the real
-- post-migration Supabase surface the oracle exists to test:
--   * asRole reads (RLS-filtered SELECT) work — they need the SELECT grant.
--   * asRole writes stay denied (42501) — DML is never granted here, matching 0045/0046.
--   * probeWrite still grants DML to `authenticated` inside its own rolled-back txn, so the
--     WITH CHECK layer remains exercised as defense-in-depth.
--
-- SELECT-only (not DML) is the whole point: granting write DML here would defeat the
-- least-privilege surface WP-SEC-3/4 established and mask a real regression. Idempotent.

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
