-- Effective-owner RLS backstop (audit F-01 / ASN-04). The four leads-family policies
-- keyed on partner_id only, which leaked a re-routed lead back to the original pipeline
-- partner. Switch each to the EFFECTIVE owner: coalesce(manual_partner_id, partner_id).
-- This matches lib/scope.ts partnerOwnsLead exactly, so the DB backstop enforces the
-- same boundary as the app layer. NOTE: the audit executive-roadmap "OR manual_partner_id
-- = app_current_partner()" shorthand is the LEAKY form (both partners keep access); the
-- coalesce form is the one that revokes the prior partner (raw audit-tenancy F-1).
-- Postgres has no CREATE OR REPLACE POLICY, so each is dropped and recreated.

drop policy if exists leads_scope on leads;--> statement-breakpoint
create policy leads_scope on leads for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or coalesce(manual_partner_id, partner_id) = app_current_partner()
    )
  )
  with check (tenant_id = app_current_tenant());--> statement-breakpoint

drop policy if exists lead_notes_scope on lead_notes;--> statement-breakpoint
create policy lead_notes_scope on lead_notes for all
  using (
    tenant_id = app_current_tenant()
    and (
      (app_current_role() = 'admin' and author_role = 'admin')
      or (
        app_current_role() = 'partner' and author_role = 'partner'
        and lead_id in (select id from leads where coalesce(manual_partner_id, partner_id) = app_current_partner())
      )
    )
  )
  with check (tenant_id = app_current_tenant());--> statement-breakpoint

drop policy if exists lead_status_history_scope on lead_status_history;--> statement-breakpoint
create policy lead_status_history_scope on lead_status_history for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or lead_id in (select id from leads where coalesce(manual_partner_id, partner_id) = app_current_partner())
    )
  )
  with check (tenant_id = app_current_tenant());--> statement-breakpoint

drop policy if exists listing_checks_scope on listing_checks;--> statement-breakpoint
create policy listing_checks_scope on listing_checks for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or lead_id in (select id from leads where coalesce(manual_partner_id, partner_id) = app_current_partner())
    )
  )
  with check (tenant_id = app_current_tenant());
