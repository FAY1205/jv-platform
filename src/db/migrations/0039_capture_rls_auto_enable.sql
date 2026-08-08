-- Custom SQL migration file, put your code below! --

-- Capture the RLS-auto-enable safety net + harden it (Supabase advisors 0028/0029).
--
-- `rls_auto_enable()` + the `ensure_rls` event trigger already exist in PROD but were created
-- out-of-band (Supabase SQL editor), so they were undocumented, absent from the test DB, and
-- outside version control. This migration brings them under drizzle so every environment matches.
--
-- What it does: on every `CREATE TABLE` in the `public` schema, the trigger enables row level
-- security automatically. That is belt-and-suspenders on top of the explicit per-table
-- `enable row level security` in migration 0001 — a forgotten enable on a future table can't
-- silently open a cross-tenant hole (SCP-01 / SEC-01). It does NOT add policies; a table with
-- RLS enabled and no policy denies by default, which is the safe failure mode.
--
-- Hardening (the actual advisor finding): the SECURITY DEFINER function had `PUBLIC` execute, so
-- `anon`/`authenticated` could invoke it via `/rest/v1/rpc`. Calling it outside an event-trigger
-- context errors harmlessly, but exposing a SECURITY DEFINER function to the API is a smell — so
-- execute is revoked from `PUBLIC`. The trigger still fires (it runs as its owner, not the
-- caller), and `postgres` (owner) keeps execute. search_path is pinned to `pg_catalog`, which
-- also clears the mutable-search_path advisor.
--
-- Idempotent: CREATE OR REPLACE + DROP ... IF EXISTS + REVOKE, so it reconciles the existing
-- prod objects and creates them fresh on the test DB / CI. Verified the `postgres` role (what
-- `drizzle-kit migrate` runs as on prod) can create event triggers on Supabase.

create or replace function public.rls_auto_enable()
  returns event_trigger
  language plpgsql
  security definer
  set search_path to 'pg_catalog'
as $fn$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog','information_schema') and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$fn$;
--> statement-breakpoint
drop event trigger if exists ensure_rls;--> statement-breakpoint
create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();--> statement-breakpoint
revoke execute on function public.rls_auto_enable() from public;
