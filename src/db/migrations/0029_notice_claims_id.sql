-- WP-SU-18: give notice_claims a surrogate uuid PK (every other table has one) so its retention
-- sweep reuses batchedDeleteByAge; the natural key (identifier, kind) becomes a UNIQUE index and
-- stays claimLockoutNotice's ON CONFLICT target. Safe as a one-shot ALTER ONLY because the table is
-- brand-new/empty (created in 0028, this same uncommitted branch, before production). The
-- gen_random_uuid() DEFAULT is VOLATILE, so ADD COLUMN backfills every row under ACCESS EXCLUSIVE (a
-- full rewrite) and the CREATE UNIQUE INDEX is not CONCURRENTLY — both fine on an empty table, but
-- DO NOT replay this pattern on a POPULATED notice_claims: use expand/contract instead (nullable id
-- + batched backfill + SET NOT NULL + CREATE UNIQUE INDEX CONCURRENTLY). Same precedent as 0027.
ALTER TABLE "notice_claims" DROP CONSTRAINT "notice_claims_identifier_kind_pk";--> statement-breakpoint
ALTER TABLE "notice_claims" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notice_claims_identifier_kind_key" ON "notice_claims" USING btree ("identifier","kind");