-- NOTE: lead_notes_author_user_idx is deliberately omitted here. It already shipped in
-- migration 0036 (hand-written, so it predated the drizzle snapshot — which is why generate
-- re-emitted it). It exists in every environment via 0036's `CREATE INDEX IF NOT EXISTS`, and
-- re-creating it here without IF NOT EXISTS would fail the migration on prod. The snapshot now
-- records it, so no future generate will re-emit it.
CREATE INDEX "coverage_zips_partner_idx" ON "coverage_zips" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "lead_notes_tenant_idx" ON "lead_notes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lead_status_history_changed_by_idx" ON "lead_status_history" USING btree ("changed_by_user_id");--> statement-breakpoint
CREATE INDEX "lead_status_history_tenant_idx" ON "lead_status_history" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leads_partner_idx" ON "leads" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "leads_original_partner_idx" ON "leads" USING btree ("original_partner_id");--> statement-breakpoint
CREATE INDEX "leads_manual_partner_idx" ON "leads" USING btree ("manual_partner_id");--> statement-breakpoint
CREATE INDEX "leads_upload_idx" ON "leads" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "listing_checks_tenant_idx" ON "listing_checks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notifications_tenant_idx" ON "notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "state_rules_partner_idx" ON "state_rules" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "uploads_source_profile_idx" ON "uploads" USING btree ("source_profile_id");