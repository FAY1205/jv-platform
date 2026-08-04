DROP INDEX "leads_tenant_dedupe_idx";--> statement-breakpoint
CREATE INDEX "leads_tenant_dedupe_idx" ON "leads" USING btree ("tenant_id","dedupe_key");