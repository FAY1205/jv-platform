CREATE TABLE "lead_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_tags_lead_tag_idx" ON "lead_tags" USING btree ("lead_id","tag_id");--> statement-breakpoint
CREATE INDEX "lead_tags_tenant_idx" ON "lead_tags" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lead_tags_tag_idx" ON "lead_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "lead_tags_added_by_idx" ON "lead_tags" USING btree ("added_by_user_id");--> statement-breakpoint
CREATE INDEX "tags_tenant_idx" ON "tags" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_tenant_name_idx" ON "tags" USING btree ("tenant_id",lower("name"));--> statement-breakpoint

-- WP-TAG-1 / TAG-02 (SEC-01): RLS backstop in lockstep with the app-layer predicate
-- (modules/tags/tags.ts `tagWhere` / `leadTagWhere`) from day one — the 0041 direction.
--
-- Tags are ADMIN-ONLY workflow labels in v1 (owner decision at mockup sign-off): partners
-- never read or write them, which is why both halves pin app_current_role() = 'admin'
-- rather than carrying a two-stream author predicate like lead_tasks. If a partner-facing
-- tag stream is ever decided it lands as an author_role column + a second policy arm —
-- never by relaxing this one.
--
-- The WITH CHECK half is NOT a tenant-only stub (0041 / audit-tenancy F-1): anon and
-- authenticated hold table grants, so a partner JWT via PostgREST could otherwise INSERT
-- a tag row, or attach an in-tenant tag to a FOREIGN lead (and a foreign tag to an
-- in-tenant lead) by writing the junction directly. Writes therefore pin the tenant, the
-- admin role, the writer's own identity, and BOTH in-tenant references. App-layer writes
-- run as table owner and bypass RLS (ADR-0013) — the tags module revalidates all of this
-- in code; this policy is the DB backstop. RLS enable is explicit (0001 style) even though
-- the ensure_rls trigger (0039) also fires.

ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
drop policy if exists tags_scope on tags;--> statement-breakpoint
create policy tags_scope on tags for all
  using (
    tenant_id = app_current_tenant()
    and app_current_role() = 'admin'
  )
  with check (
    tenant_id = app_current_tenant()
    and app_current_role() = 'admin'
  );--> statement-breakpoint

ALTER TABLE "lead_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
drop policy if exists lead_tags_scope on lead_tags;--> statement-breakpoint
create policy lead_tags_scope on lead_tags for all
  using (
    tenant_id = app_current_tenant()
    and app_current_role() = 'admin'
  )
  with check (
    tenant_id = app_current_tenant()
    and app_current_role() = 'admin'
    and added_by_user_id = app_current_user()
    and lead_id in (
      select id from leads where tenant_id = app_current_tenant()
    )
    and tag_id in (
      select id from tags where tenant_id = app_current_tenant()
    )
  );