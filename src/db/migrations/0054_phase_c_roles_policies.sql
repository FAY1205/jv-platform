-- Phase C / WP-ROLE-3 (ADR-0049, Tier A) — the NON-STRUCTURAL half. 0053 (generated,
-- snapshotted) added the enum values + columns + tables; this SQL-only file carries what
-- drizzle-kit does not track, so the snapshot ledger stays drift-free (ADR-0048/DM-13):
--
--  (1) tenants.owner_user_id backfill — the WORKSPACE OWNER ("workspace owner" ≠ ADR-0040's
--      env-allowlist "platform owner") backfills to each tenant's EARLIEST admin; tenants
--      with no admin (bare test tenants) stay NULL. + the documenting FK (RESTRICT: users
--      are never hard-deleted; hand-added so drizzle's ledger never sees it).
--  (2) SCP-08 CHECK: role and partner link move together — (role='partner') iff partner_id
--      set. Pre-flighted on the test DB: zero violating rows; provisionAdmin clears
--      partner_id on re-provision since WP-ROLE-1a (audit-tenancy F-4).
--  (3) team_invites: deny-all RLS (auth-plane, ADR-0042 — owner-connection only).
--      role_capabilities: standard tenant-only policy (tenant config, not a secret).
--      RLS enable is explicit even though the 0039 event trigger auto-enables — belt and
--      braces, and idempotent.
--  (4) The staff-arm generalization: every policy arm reading `app_current_role() = 'admin'`
--      becomes `app_current_role() <> 'partner'` so ALL admin-stream tiers (admin/member/
--      viewer) share the staff arm — NULL-safe (unbound claim ⇒ NULL ⇒ deny, RLSB-02),
--      equivalent for every existing row, and NO new enum literal appears in this file (the
--      0053 ADD VALUEs are used by no statement here — txn-safe by construction). The
--      lead_status_history author subquery's `role = 'admin'` likewise becomes
--      `role <> 'partner'`, in lockstep with lib/scope.ts statusAuthorOrg (WP-ROLE-1a).
--      Stream pins (`author_role = 'admin'`), SCP-01 partner pins (`role = 'partner'`) and
--      every partner arm are BYTE-IDENTICAL to 0044/0047; WITH CHECK >= USING preserved
--      verbatim (ADR-0046). Texts were generated from live pg_policies, not retyped.

-- ── (1) workspace-owner backfill + documenting FK ──
update "tenants" t set "owner_user_id" = (
  select u."id" from "users" u
  where u."tenant_id" = t."id" and u."role" = 'admin'
  order by u."created_at" asc, u."id" asc limit 1
) where t."owner_user_id" is null;--> statement-breakpoint
alter table "tenants" add constraint "tenants_owner_user_id_users_id_fk"
  foreign key ("owner_user_id") references "users"("id") on delete restrict;--> statement-breakpoint

-- ── (2) SCP-08: role and partner link move together ──
alter table "users" add constraint "users_partner_link_matches_role"
  check (("role" = 'partner') = ("partner_id" is not null));--> statement-breakpoint

-- ── (3) RLS posture for the two new tables ──
alter table "team_invites" enable row level security;--> statement-breakpoint
alter table "role_capabilities" enable row level security;--> statement-breakpoint
create policy role_capabilities_scope on role_capabilities for all
  using (tenant_id = app_current_tenant())
  with check (tenant_id = app_current_tenant());--> statement-breakpoint

-- ── (4) staff-arm generalization on the ten role-referencing policies ──

drop policy if exists users_scope on users;--> statement-breakpoint
create policy users_scope on users for all
  using (((tenant_id = app_current_tenant()) AND ((app_current_role() <> 'partner'::text) OR (id = app_current_user()))))
  with check ((tenant_id = app_current_tenant()));--> statement-breakpoint
drop policy if exists partners_scope on partners;--> statement-breakpoint
create policy partners_scope on partners for all
  using (((tenant_id = app_current_tenant()) AND ((app_current_role() <> 'partner'::text) OR (id = app_current_partner()))))
  with check ((tenant_id = app_current_tenant()));--> statement-breakpoint
drop policy if exists audit_log_scope on audit_log;--> statement-breakpoint
create policy audit_log_scope on audit_log for all
  using (((tenant_id = app_current_tenant()) AND ((app_current_role() <> 'partner'::text) OR (actor_user_id = app_current_user()))))
  with check ((tenant_id = app_current_tenant()));--> statement-breakpoint
drop policy if exists leads_scope on leads;--> statement-breakpoint
create policy leads_scope on leads for all
  using (((tenant_id = app_current_tenant()) AND ((app_current_role() <> 'partner'::text) OR (COALESCE(manual_partner_id, partner_id) = app_current_partner()))))
  with check (((tenant_id = app_current_tenant()) AND ((app_current_role() <> 'partner'::text) OR ((app_current_role() = 'partner'::text) AND (COALESCE(manual_partner_id, partner_id) = app_current_partner()) AND (deleted_at IS NULL)))));--> statement-breakpoint
drop policy if exists lead_notes_scope on lead_notes;--> statement-breakpoint
create policy lead_notes_scope on lead_notes for all
  using (((tenant_id = app_current_tenant()) AND (((app_current_role() <> 'partner'::text) AND (author_role = 'admin'::author_role)) OR ((app_current_role() = 'partner'::text) AND (author_role = 'partner'::author_role) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE ((leads.tenant_id = app_current_tenant()) AND (COALESCE(leads.manual_partner_id, leads.partner_id) = app_current_partner()) AND (leads.deleted_at IS NULL) AND (leads.created_at < (now() - '00:05:00'::interval))))) AND (author_user_id IN ( SELECT users.id
   FROM users
  WHERE ((users.tenant_id = app_current_tenant()) AND (users.partner_id = app_current_partner()) AND (users.role = 'partner'::role))))))))
  with check (((tenant_id = app_current_tenant()) AND (author_user_id = app_current_user()) AND (((app_current_role() <> 'partner'::text) AND (author_role = 'admin'::author_role) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE (leads.tenant_id = app_current_tenant())))) OR ((app_current_role() = 'partner'::text) AND (author_role = 'partner'::author_role) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE ((leads.tenant_id = app_current_tenant()) AND (COALESCE(leads.manual_partner_id, leads.partner_id) = app_current_partner()) AND (leads.deleted_at IS NULL) AND (leads.created_at < (now() - '00:05:00'::interval)))))))));--> statement-breakpoint
drop policy if exists lead_status_history_scope on lead_status_history;--> statement-breakpoint
create policy lead_status_history_scope on lead_status_history for all
  using (((tenant_id = app_current_tenant()) AND ((app_current_role() <> 'partner'::text) OR ((lead_id IN ( SELECT leads.id
   FROM leads
  WHERE ((leads.tenant_id = app_current_tenant()) AND (COALESCE(leads.manual_partner_id, leads.partner_id) = app_current_partner()) AND (leads.deleted_at IS NULL)))) AND (changed_by_user_id IN ( SELECT users.id
   FROM users
  WHERE ((users.tenant_id = app_current_tenant()) AND ((users.role <> 'partner'::role) OR (users.partner_id = app_current_partner())))))))))
  with check (((tenant_id = app_current_tenant()) AND (((app_current_role() <> 'partner'::text) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE (leads.tenant_id = app_current_tenant()))) AND ((changed_by_user_id IS NULL) OR (changed_by_user_id = app_current_user()))) OR ((app_current_role() = 'partner'::text) AND (changed_by_user_id = app_current_user()) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE ((leads.tenant_id = app_current_tenant()) AND (COALESCE(leads.manual_partner_id, leads.partner_id) = app_current_partner()) AND (leads.deleted_at IS NULL))))))));--> statement-breakpoint
drop policy if exists listing_checks_scope on listing_checks;--> statement-breakpoint
create policy listing_checks_scope on listing_checks for all
  using (((tenant_id = app_current_tenant()) AND ((app_current_role() <> 'partner'::text) OR (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE ((leads.tenant_id = app_current_tenant()) AND (COALESCE(leads.manual_partner_id, leads.partner_id) = app_current_partner()) AND (leads.deleted_at IS NULL)))))))
  with check (((tenant_id = app_current_tenant()) AND (((app_current_role() <> 'partner'::text) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE (leads.tenant_id = app_current_tenant())))) OR ((app_current_role() = 'partner'::text) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE ((leads.tenant_id = app_current_tenant()) AND (COALESCE(leads.manual_partner_id, leads.partner_id) = app_current_partner()) AND (leads.deleted_at IS NULL))))))));--> statement-breakpoint
drop policy if exists lead_tasks_scope on lead_tasks;--> statement-breakpoint
create policy lead_tasks_scope on lead_tasks for all
  using (((tenant_id = app_current_tenant()) AND (((app_current_role() <> 'partner'::text) AND (author_role = 'admin'::author_role)) OR ((app_current_role() = 'partner'::text) AND (author_role = 'partner'::author_role) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE ((leads.tenant_id = app_current_tenant()) AND (COALESCE(leads.manual_partner_id, leads.partner_id) = app_current_partner()) AND (leads.deleted_at IS NULL) AND (leads.created_at < (now() - '00:05:00'::interval))))) AND (author_user_id IN ( SELECT users.id
   FROM users
  WHERE ((users.tenant_id = app_current_tenant()) AND (users.partner_id = app_current_partner()) AND (users.role = 'partner'::role))))))))
  with check (((tenant_id = app_current_tenant()) AND (author_user_id = app_current_user()) AND ((assigned_to_user_id IS NULL) OR (assigned_to_user_id IN ( SELECT users.id
   FROM users
  WHERE (users.tenant_id = app_current_tenant())))) AND (((app_current_role() <> 'partner'::text) AND (author_role = 'admin'::author_role) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE (leads.tenant_id = app_current_tenant())))) OR ((app_current_role() = 'partner'::text) AND (author_role = 'partner'::author_role) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE ((leads.tenant_id = app_current_tenant()) AND (COALESCE(leads.manual_partner_id, leads.partner_id) = app_current_partner()) AND (leads.deleted_at IS NULL) AND (leads.created_at < (now() - '00:05:00'::interval)))))))));--> statement-breakpoint
drop policy if exists tags_scope on tags;--> statement-breakpoint
create policy tags_scope on tags for all
  using (((tenant_id = app_current_tenant()) AND (app_current_role() <> 'partner'::text)))
  with check (((tenant_id = app_current_tenant()) AND (app_current_role() <> 'partner'::text)));--> statement-breakpoint
drop policy if exists lead_tags_scope on lead_tags;--> statement-breakpoint
create policy lead_tags_scope on lead_tags for all
  using (((tenant_id = app_current_tenant()) AND (app_current_role() <> 'partner'::text)))
  with check (((tenant_id = app_current_tenant()) AND (app_current_role() <> 'partner'::text) AND (added_by_user_id = app_current_user()) AND (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE (leads.tenant_id = app_current_tenant()))) AND (tag_id IN ( SELECT tags.id
   FROM tags
  WHERE (tags.tenant_id = app_current_tenant())))));
