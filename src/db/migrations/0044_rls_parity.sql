-- Supabase-compatibility shim: the `anon`/`authenticated` roles are provided by the Supabase
-- platform in every real environment (dev/test/prod), but a vanilla Postgres — the CI integration
-- service container — has neither, which makes the later `REVOKE … FROM anon, authenticated`
-- (migrations 0045/0046) fail `db:migrate`. Create them idempotently so migrations apply in ANY
-- environment; this is a NO-OP on Supabase (the roles already exist, so `create role` never runs).
-- The RLS enforcement oracle still needs the full Supabase grant surface, so its suites self-skip
-- on non-Supabase DBs (IS_SUPABASE_DB in tests/helpers/rls.ts).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
--> statement-breakpoint

-- WP-SEC-2 / RLP-01..06 (ADR-0046, SEC-01): bring every lead-child policy up to the
-- lead_tasks_scope (0041) two-half standard. The app connects as the table owner and
-- bypasses RLS (ADR-0013); these policies are the ONLY gate on the authenticated/PostgREST
-- surface, where full CRUD grants exist (verified live). Two classes of gap are closed:
--
--   (1) lead_notes_scope (0010) USING scoped a partner by lead-ownership ONLY — no own-org
--       author predicate and no deleted_at filter. Lead ownership moves on re-route
--       (coalesce(manual_partner_id, partner_id)), so a new owner could read the PRIOR
--       partner's notes at the DB layer — the R-22 leak 0037 closed for status history,
--       still open for notes. RLP-02 adds both predicates.
--
--   (2) Every pre-0041 lead-child policy carried a tenant-only WITH CHECK. INSERT is gated
--       by WITH CHECK alone (no old row for USING to check), so a partner JWT could fabricate
--       a lead owned by another partner, insert a note into the admin stream, or write a
--       child row onto a lead it does not own. RLP-01/03/04/05 pin identity, stream, and
--       in-tenant/owned references on writes, mirroring lead_tasks_scope.
--
-- RLP-06 + SCP-01 (lib/scope.ts): the own-org-author subquery pins role='partner' — an admin
-- row with a stray partner_id must not be counted into a partner org's authored set. The
-- status-history author predicate (role='admin' OR partner_id=me) is a DIFFERENT, intentional
-- semantic (admin status changes stay visible to the current owner) and is NOT role-pinned.
--
-- App writes run as the service role and revalidate everything in code; this is the DB
-- backstop. System-authored rows (lead_status_history.changed_by_user_id IS NULL,
-- listing_checks) are written as the owner and bypass RLS — the WITH CHECK author arms admit
-- them via a null-author arm rather than forbidding them. Postgres has no CREATE OR REPLACE
-- POLICY, so each is dropped and recreated.

-- ── RLP-01: leads_scope — WITH CHECK from tenant-only to owner+live (blocks INSERT fabrication) ──
drop policy if exists leads_scope on leads;--> statement-breakpoint
create policy leads_scope on leads for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or coalesce(manual_partner_id, partner_id) = app_current_partner()
    )
  )
  with check (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or (
        app_current_role() = 'partner'
        and coalesce(manual_partner_id, partner_id) = app_current_partner()
        and deleted_at is null
      )
    )
  );--> statement-breakpoint

-- ── RLP-02 (USING own-author + deleted_at) + RLP-03 (WITH CHECK identity+stream+lead) ──
drop policy if exists lead_notes_scope on lead_notes;--> statement-breakpoint
create policy lead_notes_scope on lead_notes for all
  using (
    tenant_id = app_current_tenant()
    and (
      (app_current_role() = 'admin' and author_role = 'admin')
      or (
        app_current_role() = 'partner' and author_role = 'partner'
        and lead_id in (
          select id from leads
          where tenant_id = app_current_tenant()
            and coalesce(manual_partner_id, partner_id) = app_current_partner()
            and deleted_at is null
        )
        and author_user_id in (
          select id from users
          where tenant_id = app_current_tenant()
            and partner_id = app_current_partner()
            and role = 'partner'
        )
      )
    )
  )
  with check (
    tenant_id = app_current_tenant()
    and author_user_id = app_current_user()
    and (
      (
        app_current_role() = 'admin' and author_role = 'admin'
        and lead_id in (select id from leads where tenant_id = app_current_tenant())
      )
      or (
        app_current_role() = 'partner' and author_role = 'partner'
        and lead_id in (
          select id from leads
          where tenant_id = app_current_tenant()
            and coalesce(manual_partner_id, partner_id) = app_current_partner()
            and deleted_at is null
        )
      )
    )
  );--> statement-breakpoint

-- ── RLP-04: lead_status_history_scope — inner subquery scoped; WITH CHECK author+ownership ──
drop policy if exists lead_status_history_scope on lead_status_history;--> statement-breakpoint
create policy lead_status_history_scope on lead_status_history for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or (
        lead_id in (
          select id from leads
          where tenant_id = app_current_tenant()
            and coalesce(manual_partner_id, partner_id) = app_current_partner()
            and deleted_at is null
        )
        and changed_by_user_id in (
          select id from users
          where tenant_id = app_current_tenant()
            and (role = 'admin' or partner_id = app_current_partner())
        )
      )
    )
  )
  with check (
    tenant_id = app_current_tenant()
    and (
      (
        -- Admin may write its own entries; the null-author arm is admin-scoped so an
        -- authenticated partner cannot forge a system-authored (changed_by_user_id IS NULL)
        -- status row (audit-security/audit-tenancy: the only legitimate null-author writer is
        -- the service role, which bypasses RLS as owner).
        app_current_role() = 'admin'
        and lead_id in (select id from leads where tenant_id = app_current_tenant())
        and (changed_by_user_id is null or changed_by_user_id = app_current_user())
      )
      or (
        app_current_role() = 'partner'
        and changed_by_user_id = app_current_user()
        and lead_id in (
          select id from leads
          where tenant_id = app_current_tenant()
            and coalesce(manual_partner_id, partner_id) = app_current_partner()
            and deleted_at is null
        )
      )
    )
  );--> statement-breakpoint

-- ── RLP-05: listing_checks_scope — inner subquery scoped; WITH CHECK mirrors USING (no author col) ──
drop policy if exists listing_checks_scope on listing_checks;--> statement-breakpoint
create policy listing_checks_scope on listing_checks for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or lead_id in (
        select id from leads
        where tenant_id = app_current_tenant()
          and coalesce(manual_partner_id, partner_id) = app_current_partner()
          and deleted_at is null
      )
    )
  )
  with check (
    tenant_id = app_current_tenant()
    and (
      (
        app_current_role() = 'admin'
        and lead_id in (select id from leads where tenant_id = app_current_tenant())
      )
      or (
        app_current_role() = 'partner'
        and lead_id in (
          select id from leads
          where tenant_id = app_current_tenant()
            and coalesce(manual_partner_id, partner_id) = app_current_partner()
            and deleted_at is null
        )
      )
    )
  );--> statement-breakpoint

-- ── RLP-06: lead_tasks_scope — own-org author subquery pins role='partner' (SCP-01, C-15) ──
drop policy if exists lead_tasks_scope on lead_tasks;--> statement-breakpoint
create policy lead_tasks_scope on lead_tasks for all
  using (
    tenant_id = app_current_tenant()
    and (
      (app_current_role() = 'admin' and author_role = 'admin')
      or (
        app_current_role() = 'partner' and author_role = 'partner'
        and lead_id in (
          select id from leads
          where tenant_id = app_current_tenant()
            and coalesce(manual_partner_id, partner_id) = app_current_partner()
            and deleted_at is null
        )
        and author_user_id in (
          select id from users
          where tenant_id = app_current_tenant()
            and partner_id = app_current_partner()
            and role = 'partner'
        )
      )
    )
  )
  with check (
    tenant_id = app_current_tenant()
    and author_user_id = app_current_user()
    and (
      assigned_to_user_id is null
      or assigned_to_user_id in (
        select id from users where tenant_id = app_current_tenant()
      )
    )
    and (
      (
        app_current_role() = 'admin' and author_role = 'admin'
        and lead_id in (select id from leads where tenant_id = app_current_tenant())
      )
      or (
        app_current_role() = 'partner' and author_role = 'partner'
        and lead_id in (
          select id from leads
          where tenant_id = app_current_tenant()
            and coalesce(manual_partner_id, partner_id) = app_current_partner()
            and deleted_at is null
        )
      )
    )
  );
