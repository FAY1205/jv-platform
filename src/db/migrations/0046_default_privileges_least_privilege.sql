-- WP-SEC-4 / SEC4-01..02 (ADR-0046 Decision-7, pr-reviewer #79 F-1): schema-wide least
-- privilege. WP-SEC-3 (0045) revoked write DML on the five lead-family tables, but pg_default_acl
-- shows Supabase's `public` schema auto-grants FULL DML (arwdDxtm) to BOTH anon and authenticated
-- on every NEW table created by `postgres`. So 0045 was a per-table band-aid: every OTHER tenant
-- table (tags, saved_views, partners, coverage_zips, users, notifications, …) carries the same
-- DELETE/column-tamper hole on the authenticated/PostgREST surface, and any future table re-opens
-- it. The app connects as the table OWNER (ADR-0013) and never uses these grants (no client-side
-- `supabase.from()` anywhere), so no public table needs anon/authenticated write DML.
--
-- Two halves: (1) stop the bleed for FUTURE tables — ALTER DEFAULT PRIVILEGES for the role
-- migrations run as (postgres), so newly-created public tables are not auto-granted write DML;
-- (2) sweep EVERY existing public table. SELECT is retained (read policies remain the gate).
-- service_role and the owner are untouched. Idempotent: REVOKE of an absent privilege is a no-op.
-- Migrations run as postgres; supabase_admin-owned system tables (its own default ACL) are out of
-- scope — they are Supabase-managed and not tenant data.

-- Bounded lock wait (audit-security F-1): the sweep below locks every public table in one
-- transaction, and this runs via migrate-on-merge against live prod. Fail fast on contention so
-- the deploy retries cleanly instead of queuing new queries behind a blocked REVOKE. `set local`
-- scopes these to the migration transaction (drizzle wraps each migration in one txn).
set local lock_timeout = '3s';--> statement-breakpoint
set local statement_timeout = '30s';--> statement-breakpoint

-- (1) future tables created by postgres in public. All 34 existing public tables are
-- postgres-owned (verified), so the postgres-keyed default ACL is the only one governing app
-- tables; the separate supabase_admin default ACL is left intact (out of scope — Supabase-managed,
-- and no app table is created by that role).
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;--> statement-breakpoint

-- (2) one-time sweep of every existing public table
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;
