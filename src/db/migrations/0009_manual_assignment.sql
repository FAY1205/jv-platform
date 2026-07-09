ALTER TABLE "leads" ADD COLUMN "manual_partner_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "manual_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "manual_assigned_by" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "manual_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_manual_partner_id_partners_id_fk" FOREIGN KEY ("manual_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_tenant_manual_partner_idx" ON "leads" USING btree ("tenant_id","manual_partner_id");