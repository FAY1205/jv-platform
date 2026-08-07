-- R-22 defence-in-depth (SEC-01): keep the lead_status_history RLS backstop in lockstep with the
-- app-layer predicate (lib/scope.ts ownStatusAuthorScope). A lead's status timeline follows ownership
-- on re-route (coalesce(manual_partner_id, partner_id)), so scoping a partner ONLY by lead-ownership
-- (migration 0010) let the NEW owner read the PRIOR partner's entries at the RLS layer. Restrict a
-- partner to entries authored by their OWN org OR by an admin/system — hiding only ANOTHER partner's
-- entries (owner decision 2026-08-07: an admin's inline status change stays visible to the current
-- owner; status is one shared field, unlike the two-stream notes model). Admin sees all. The service
-- role bypasses RLS; this guards any future non-service (authenticated) access. Postgres has no
-- CREATE OR REPLACE POLICY, so drop + recreate.

drop policy if exists lead_status_history_scope on lead_status_history;--> statement-breakpoint
create policy lead_status_history_scope on lead_status_history for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or (
        lead_id in (select id from leads where coalesce(manual_partner_id, partner_id) = app_current_partner())
        and changed_by_user_id in (
          select id from users
          where tenant_id = app_current_tenant()
            and (role = 'admin' or partner_id = app_current_partner())
        )
      )
    )
  )
  with check (tenant_id = app_current_tenant());
