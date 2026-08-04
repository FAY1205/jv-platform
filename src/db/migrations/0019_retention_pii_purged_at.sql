-- WP-GL-B (DM-09/LGL-02): add the retention-sweep purge marker + its scan index. Additive + nullable:
--   * RLS   - unchanged: leads_scope (migration 0001) is row-level (tenant_id/partner_id in the
--             USING clause); Postgres RLS has no column granularity, so a new column needs no policy.
--   * Index - leads_pii_purge_idx, partial on the sweep's exact predicate (below).
--   * Seed  - none: src/db/seed.ts never inserts leads rows.
ALTER TABLE "leads" ADD COLUMN "pii_purged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "leads_pii_purge_idx" ON "leads" USING btree ("tenant_id","deleted_at") WHERE "leads"."pii_purged_at" is null and "leads"."deleted_at" is not null;