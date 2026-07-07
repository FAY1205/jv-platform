-- ─────────────────────────────────────────────────────────────────────────────
-- RLS (SEC-01, PRN-08), the current-coverage constraint, and JWT-claim helpers.
-- Ships in the same migration set as the schema (API-04).
--
-- Access model: the server uses the service role (which BYPASSES RLS) behind the
-- scoping guard (lib/scope.ts, WP-006). These policies are defense-in-depth for
-- any non-service (authenticated) access — e.g. the partner portal. Claims come
-- from the Supabase JWT (app_metadata), populated at auth time (WP-007). When no
-- claims are set the helpers return NULL, so policies deny by default.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Claim helpers ──
create or replace function app_current_claims() returns jsonb
  language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function app_current_tenant() returns uuid
  language sql stable as $$
  select nullif(app_current_claims() #>> '{app_metadata,tenant_id}', '')::uuid
$$;

create or replace function app_current_role() returns text
  language sql stable as $$
  select app_current_claims() #>> '{app_metadata,role}'
$$;

create or replace function app_current_partner() returns uuid
  language sql stable as $$
  select nullif(app_current_claims() #>> '{app_metadata,partner_id}', '')::uuid
$$;

create or replace function app_current_user() returns uuid
  language sql stable as $$
  select nullif(app_current_claims() ->> 'sub', '')::uuid
$$;

-- ── Unique CURRENT coverage per (tenant, zip5) (DM-06) ──
create unique index if not exists coverage_current_zip_idx
  on coverage_zips (tenant_id, zip5)
  where effective_to is null;

-- ── Enable RLS on every table (SEC-01) ──
alter table tenants             enable row level security;
alter table users               enable row level security;
alter table partners            enable row level security;
alter table coverage_zips       enable row level security;
alter table state_rules         enable row level security;
alter table mls_patterns        enable row level security;
alter table campaign_recodes    enable row level security;
alter table source_profiles     enable row level security;
alter table uploads             enable row level security;
alter table leads               enable row level security;
alter table lead_notes          enable row level security;
alter table lead_status_history enable row level security;
alter table listing_checks      enable row level security;
alter table notifications       enable row level security;
alter table events              enable row level security;
alter table audit_log           enable row level security;
alter table settings            enable row level security;
alter table feature_flags       enable row level security;
alter table ai_memory           enable row level security;
alter table ai_feedback         enable row level security;
alter table ref_counters        enable row level security;

-- ── Root: a caller only sees their own tenant ──
create policy tenants_scope on tenants for all
  using (id = app_current_tenant())
  with check (id = app_current_tenant());

-- ── Tenant-isolation policies (admin-facing / tenant-wide tables) ──
-- coverage_zips
create policy coverage_zips_scope on coverage_zips for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- state_rules
create policy state_rules_scope on state_rules for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- mls_patterns
create policy mls_patterns_scope on mls_patterns for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- campaign_recodes
create policy campaign_recodes_scope on campaign_recodes for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- source_profiles
create policy source_profiles_scope on source_profiles for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- uploads
create policy uploads_scope on uploads for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- events
create policy events_scope on events for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- settings
create policy settings_scope on settings for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- feature_flags
create policy feature_flags_scope on feature_flags for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- ai_memory
create policy ai_memory_scope on ai_memory for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- ai_feedback
create policy ai_feedback_scope on ai_feedback for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());
-- ref_counters
create policy ref_counters_scope on ref_counters for all
  using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant());

-- ── Users: admins see the tenant roster; anyone sees their own row ──
create policy users_scope on users for all
  using (
    tenant_id = app_current_tenant()
    and (app_current_role() = 'admin' or id = app_current_user())
  )
  with check (tenant_id = app_current_tenant());

-- ── Partners: admins see all; a partner sees only their own record ──
create policy partners_scope on partners for all
  using (
    tenant_id = app_current_tenant()
    and (app_current_role() = 'admin' or id = app_current_partner())
  )
  with check (tenant_id = app_current_tenant());

-- ── Leads: admins see all tenant leads; partners see only their own (TST-01) ──
create policy leads_scope on leads for all
  using (
    tenant_id = app_current_tenant()
    and (app_current_role() = 'admin' or partner_id = app_current_partner())
  )
  with check (tenant_id = app_current_tenant());

-- ── Lead notes: admin notes and partner notes are mutually invisible (PRN-13, TST-08) ──
create policy lead_notes_scope on lead_notes for all
  using (
    tenant_id = app_current_tenant()
    and (
      (app_current_role() = 'admin' and author_role = 'admin')
      or (
        app_current_role() = 'partner' and author_role = 'partner'
        and lead_id in (select id from leads where partner_id = app_current_partner())
      )
    )
  )
  with check (tenant_id = app_current_tenant());

-- ── Status history: partners only for their own leads ──
create policy lead_status_history_scope on lead_status_history for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or lead_id in (select id from leads where partner_id = app_current_partner())
    )
  )
  with check (tenant_id = app_current_tenant());

-- ── Listing checks: partners only for their own leads ──
create policy listing_checks_scope on listing_checks for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or lead_id in (select id from leads where partner_id = app_current_partner())
    )
  )
  with check (tenant_id = app_current_tenant());

-- ── Notifications: a user only sees their own ──
create policy notifications_scope on notifications for all
  using (tenant_id = app_current_tenant() and user_id = app_current_user())
  with check (tenant_id = app_current_tenant());

-- ── Audit log: admins see the tenant trail; others see only their own actions (ACT-02) ──
create policy audit_log_scope on audit_log for all
  using (
    tenant_id = app_current_tenant()
    and (app_current_role() = 'admin' or actor_user_id = app_current_user())
  )
  with check (tenant_id = app_current_tenant());
