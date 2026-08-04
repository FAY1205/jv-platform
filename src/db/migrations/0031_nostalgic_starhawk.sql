ALTER TABLE "partners" ADD COLUMN "is_house" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- WP-D (ADR-0037): at most ONE active house partner per tenant. Partial unique index (kept as
-- raw SQL, mirroring the coverage_zips partial index in 0001 — drizzle's schema tracking does not
-- own it). A soft-deleted house row (deleted_at set) is excluded, so re-creating is always possible.
CREATE UNIQUE INDEX IF NOT EXISTS "partners_one_house_per_tenant_idx"
  ON "partners" ("tenant_id")
  WHERE "is_house" AND "deleted_at" IS NULL;