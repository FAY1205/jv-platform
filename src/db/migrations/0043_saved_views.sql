CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_user_name_idx" ON "saved_views" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "saved_views_tenant_idx" ON "saved_views" USING btree ("tenant_id");--> statement-breakpoint

-- WP-SV-1 / SV-01 (SEC-01): the RLS backstop, in lockstep with the app-layer predicate
-- (modules/saved-views/saved-views.ts `savedViewWhere`) from day one — the 0041/0042 direction.
--
-- A saved view introduces a NEW isolation axis: tenant is not enough, because two admins share
-- a tenant and a view is a PERSONAL bookmark (owner decision — shared/team views are out of
-- v1). So BOTH halves pin tenant AND the row's owner: `user_id = app_current_user()`. The
-- WITH CHECK half is not a tenant-only stub (audit-tenancy F-1 on 0041): anon and authenticated
-- hold table grants, so without the user pin on the write half a session could INSERT a row
-- naming ANOTHER user as its owner — planting a view in a colleague's menu — or UPDATE its own
-- row's user_id to hand it away. Pinning the writer on both halves closes both.
--
-- The tenant/user PAIR is app-enforced, not FK-enforced (audit-tenancy F-6). Nothing in the
-- schema says `user_id` must belong to `tenant_id`: that would need a composite FK, which in
-- turn needs a UNIQUE (id, tenant_id) on `users` — a schema change reaching a table every other
-- table already references. It is not needed, because a row's two columns come from ONE
-- `ScopeContext` on the single write path (modules/saved-views), and `savedViewWhere` AND-s
-- both halves on every read: a mismatched pair, however it arrived, matches NOTHING rather
-- than matching the wrong person. It fails closed. Revisit only if a second writer appears.
--
-- Deliberately NOT pinned here: `app_current_role() = 'admin'`. Admin-only is a v1 PRODUCT gate
-- (a partner's portal has no leads-page filter state to save), enforced at the route AND in the
-- module — it is not a data-VISIBILITY rule, and the per-user pin above already means no
-- session can read or write a row that isn't its own whatever its role. Writing the role in
-- would have to be RELAXED (not extended) the day partner views ship, and a policy you expect
-- to loosen is a policy that gets loosened carelessly. ADR-0045 records that decision and its
-- trigger: relaxing the user pin (shared/team views, partner views) REQUIRES a role arm landing
-- in this policy in the SAME migration. App-layer writes run as table owner and
-- bypass RLS (ADR-0013); the module revalidates all of this in code. RLS enable is explicit
-- (0001 style) even though the ensure_rls trigger (0039) also fires.

ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
drop policy if exists saved_views_scope on saved_views;--> statement-breakpoint
create policy saved_views_scope on saved_views for all
  using (
    tenant_id = app_current_tenant()
    and user_id = app_current_user()
  )
  with check (
    tenant_id = app_current_tenant()
    and user_id = app_current_user()
  );