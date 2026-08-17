-- C-8 / WP-TSK-2a: fold the DISTRIBUTION HOLD into the RLS backstop, in lockstep with the app
-- guard (lib/scope.ts taskWhere/noteWhere). A newly-imported lead is HELD from its partner for the
-- void window (HOLD_WINDOW_MS = VOID_WINDOW_MS = 5 minutes) so a within-window void is clean — the
-- leads were never partner-visible. The app computes release at read time from the lead's own
-- created_at (src/modules/run/hold-filter.ts: leads.created_at < now - 5min). Before this, the
-- lead_tasks_scope / lead_notes_scope partner arms filtered ownership + soft-delete but were
-- hold-BLIND, so the app compensated with local `partnerHoldGate`/lead-resolution conjuncts. This
-- moves the predicate into the policy so app + RLS carry it together (SEC-01, WP-SEC-2 discipline).
--
-- The predicate is added ONLY to the partner `ownLeads` subqueries, in BOTH the USING arm (reads +
-- the USING half of UPDATE/DELETE) and the WITH CHECK arm (INSERT + the new row on UPDATE) — so
-- WITH CHECK ≥ USING holds (ADR-0046): a partner can neither read nor write a task/note on a lead
-- it cannot yet see. Admin arms are never hold-gated (admin sees leads immediately).
--
-- ⚠️ MIRROR: `interval '5 minutes'` mirrors VOID_WINDOW_MS (src/modules/run/void-window.ts). The app
-- guard is the source of truth (ADR-0013 — the service role bypasses RLS); this policy is the
-- defense-in-depth backstop for the authenticated/PostgREST surface. If VOID_WINDOW_MS changes,
-- change this interval too (same JS↔SQL mirror discipline as ownStatusAuthorScope). now() is the
-- transaction clock (vs the app's request-time new Date()); the skew is immaterial for a backstop.
--
-- Postgres has no CREATE OR REPLACE POLICY, so each policy is dropped and recreated verbatim from
-- 0044 with the hold predicate inserted into the four partner ownLeads subqueries.

-- ── lead_tasks_scope: hold added to partner ownLeads in USING + WITH CHECK (RLP-06 shape) ──
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
            and created_at < now() - interval '5 minutes'
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
            and created_at < now() - interval '5 minutes'
        )
      )
    )
  );--> statement-breakpoint

-- ── lead_notes_scope: hold added to partner ownLeads in USING + WITH CHECK (RLP-02/03 shape) ──
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
            and created_at < now() - interval '5 minutes'
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
            and created_at < now() - interval '5 minutes'
        )
      )
    )
  );
