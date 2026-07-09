CREATE INDEX "leads_tenant_created_idx" ON "leads" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_tenant_state_idx" ON "leads" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "leads_tenant_campaign_idx" ON "leads" USING btree ("tenant_id","campaign");