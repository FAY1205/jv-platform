-- C-13 / WP-RET-3a: give notifications a nullable lead_ref (refId string, mirrors
-- email_outbox.meta.leadRef) so the void/purge paths can find + redact a soft-deleted lead's
-- notifications (the task_due title embeds the task free text = seller PII). Partial index
-- (lead_ref is not null) keeps it small — only lead-scoped notifications carry a ref.
ALTER TABLE "notifications" ADD COLUMN "lead_ref" text;--> statement-breakpoint
CREATE INDEX "notifications_tenant_leadref_idx" ON "notifications" USING btree ("tenant_id","lead_ref") WHERE lead_ref is not null;