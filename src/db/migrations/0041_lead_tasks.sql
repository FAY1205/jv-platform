CREATE TABLE "lead_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_role" "author_role" NOT NULL,
	"assigned_to_user_id" uuid,
	"title" text NOT NULL,
	"due_on" date,
	"done_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_tasks_lead_idx" ON "lead_tasks" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_tasks_tenant_idx" ON "lead_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lead_tasks_author_user_idx" ON "lead_tasks" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "lead_tasks_assignee_idx" ON "lead_tasks" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "lead_tasks_open_due_idx" ON "lead_tasks" USING btree ("tenant_id","due_on") WHERE done_at is null;--> statement-breakpoint

-- WP-TSK-1 / ADR-0044 (SEC-01): RLS backstop in lockstep with the app-layer predicate
-- (lib/scope.ts taskWhere) from day one — the 0037 direction, not 0010's coarser shape.
-- Two-stream visibility (PRN-13): admin sees only admin tasks; a partner sees only tasks
-- AUTHORED BY THEIR OWN ORG on leads they CURRENTLY own. Lead ownership moves on re-route
-- (coalesce(manual_partner_id, partner_id)), so lead-ownership alone would hand the prior
-- org's tasks to the new owner — the own-org author predicate closes that, and the
-- deleted_at filter keeps recalled (voided) leads' tasks out of partner reads (DM-09b).
--
-- The WITH CHECK half is NOT the 0010-style tenant-only stub (audit-tenancy F-1, WP-TSK-1):
-- anon/authenticated hold table grants (verified live), so a partner JWT via PostgREST could
-- otherwise INSERT into the admin stream, re-point lead_id across the PRN-13 wall on UPDATE,
-- or write a cross-tenant assignee. Writes must pin author identity (app_current_user),
-- the author's own stream, an IN-TENANT lead (owned + live for partners), and an in-tenant
-- assignee. App-layer writes run as table owner and bypass RLS (ADR-0013) — WP-TSK-2's
-- write path revalidates all of this in code; this policy is the DB backstop.
-- RLS enable is explicit (0001 style) even though the ensure_rls trigger (0039) also fires.

ALTER TABLE "lead_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
        and lead_id in (
          select id from leads where tenant_id = app_current_tenant()
        )
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