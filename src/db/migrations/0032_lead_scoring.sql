CREATE TYPE "public"."score_group" AS ENUM('hot', 'warm', 'nurture');--> statement-breakpoint
CREATE TYPE "public"."score_status" AS ENUM('complete', 'incomplete');--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_total" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_group" "score_group";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_status" "score_status" DEFAULT 'incomplete' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_breakdown" jsonb;--> statement-breakpoint
CREATE INDEX "leads_tenant_score_idx" ON "leads" USING btree ("tenant_id","score_group","created_at");