-- Distribution hold: the partner-push (digest + notifications) idempotency marker. Additive + nullable:
--   * RLS   - unchanged: uploads is server-managed (service role), row-level tenant scoping applies;
--             a new column needs no policy.
--   * Index - uploads_pending_release_idx, partial on exactly the release-scan predicate (below).
--   * Seed  - none: src/db/seed.ts never inserts uploads rows.
ALTER TABLE "uploads" ADD COLUMN "distributed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "uploads_pending_release_idx" ON "uploads" USING btree ("tenant_id","created_at") WHERE "uploads"."distributed_at" is null and "uploads"."voided_at" is null;