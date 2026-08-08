-- Custom SQL migration file, put your code below! --

-- Pin the search_path on the RLS-critical claim helpers + the audit-immutability trigger
-- (Supabase advisor 0011 function_search_path_mutable). All six are SECURITY INVOKER, so the
-- attack surface is small, but a mutable search_path is still flagged and worth closing.
--
-- Config-only ALTER, NOT a body rewrite: app_current_* are called by EVERY RLS policy, so
-- re-stating their bodies would risk a typo breaking tenant isolation. `pg_catalog, public`
-- resolves the built-ins (pg_catalog first, so they can't be shadowed) AND the one cross-schema
-- reference — app_current_partner/role/tenant/user call public.app_current_claims(). Idempotent;
-- verified in a rolled-back txn that all six still resolve + return correctly after the pin.

alter function public.app_current_claims() set search_path = pg_catalog, public;--> statement-breakpoint
alter function public.app_current_tenant() set search_path = pg_catalog, public;--> statement-breakpoint
alter function public.app_current_role() set search_path = pg_catalog, public;--> statement-breakpoint
alter function public.app_current_partner() set search_path = pg_catalog, public;--> statement-breakpoint
alter function public.app_current_user() set search_path = pg_catalog, public;--> statement-breakpoint
alter function public.reject_audit_log_mutation() set search_path = pg_catalog, public;
