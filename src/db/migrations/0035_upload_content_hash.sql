ALTER TABLE "uploads" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "uploads_tenant_content_hash_idx" ON "uploads" USING btree ("tenant_id","content_hash");