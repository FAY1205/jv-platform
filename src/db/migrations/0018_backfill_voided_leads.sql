-- WP-J2 (ING-09 / DM-09) backfill: before WP-J2, voiding set uploads.status='voided' but never
-- soft-deleted the leads. Now that deleted_at is the universal recall/exclusion signal (and the
-- unique index is partial on deleted_at IS NULL), soft-delete the leads of any already-voided
-- upload so legacy voided runs are consistent — recalled everywhere + re-uploadable by dedupe_key.
UPDATE "leads" l
SET "deleted_at" = COALESCE(u."voided_at", now())
FROM "uploads" u
WHERE l."upload_id" = u."id" AND u."status" = 'voided' AND l."deleted_at" IS NULL;
