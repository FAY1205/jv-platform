CREATE TYPE "public"."author_role" AS ENUM('admin', 'partner');--> statement-breakpoint
CREATE TYPE "public"."feedback_rating" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('pending', 'yes', 'no', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('zip', 'state_fallback', 'none');--> statement-breakpoint
CREATE TYPE "public"."mls_status" AS ENUM('kept', 'removed');--> statement-breakpoint
CREATE TYPE "public"."partner_status" AS ENUM('not_invited', 'invited', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."pattern_type" AS ENUM('disqualify', 'keep_override');--> statement-breakpoint
CREATE TYPE "public"."possible_mls" AS ENUM('yes', 'no', 'unknown', 'pending');--> statement-breakpoint
CREATE TYPE "public"."ref_entity" AS ENUM('partner', 'lead', 'upload');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'partner');--> statement-breakpoint
CREATE TYPE "public"."strictness" AS ENUM('flexible', 'strict');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('queued', 'processing', 'processed', 'voided');--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"rating" "feedback_rating" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_ref" text,
	"before" jsonb,
	"after" jsonb,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"match_pattern" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coverage_zips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"zip5" text NOT NULL,
	"county" text,
	"region" text,
	"partner_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_role" "author_role" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" text NOT NULL,
	"changed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref_id" text NOT NULL,
	"upload_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"raw_json" jsonb NOT NULL,
	"campaign" text,
	"date_created" text,
	"notes" text,
	"address" text,
	"address_normalized" text,
	"city" text,
	"state" text,
	"zip" text,
	"seller_first" text,
	"seller_last" text,
	"phone" text,
	"phone_norm" text,
	"email" text,
	"reason_for_selling" text,
	"motivation" text,
	"time_to_sell" text,
	"partner_id" uuid,
	"match_method" "match_method" DEFAULT 'none' NOT NULL,
	"mls_status" "mls_status" DEFAULT 'kept' NOT NULL,
	"mls_reason" text,
	"mls_pattern_key" text,
	"mls_match_span" jsonb,
	"previously_matched" boolean DEFAULT false NOT NULL,
	"original_partner_id" uuid,
	"first_matched_at" timestamp with time zone,
	"possible_mls_listing" "possible_mls" DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" "listing_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mls_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pattern_key" text NOT NULL,
	"type" "pattern_type" NOT NULL,
	"regex" text NOT NULL,
	"flags" text DEFAULT 'i' NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"deep_link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"color" text NOT NULL,
	"deal_terms" text,
	"admin_notes" text,
	"status" "partner_status" DEFAULT 'not_invited' NOT NULL,
	"invited_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"last_portal_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_counters" (
	"tenant_id" uuid NOT NULL,
	"entity" "ref_entity" NOT NULL,
	"year" integer NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ref_counters_tenant_id_entity_year_pk" PRIMARY KEY("tenant_id","entity","year")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"header_signature" jsonb NOT NULL,
	"mapping" jsonb NOT NULL,
	"required_columns" jsonb NOT NULL,
	"strictness" "strictness" DEFAULT 'flexible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"state" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref_id" text NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text,
	"source_profile_id" uuid,
	"source_profile_version" integer,
	"status" "upload_status" DEFAULT 'queued' NOT NULL,
	"row_count" integer,
	"rules_hash" text,
	"rules_snapshot" jsonb,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "role" NOT NULL,
	"partner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_memory" ADD CONSTRAINT "ai_memory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recodes" ADD CONSTRAINT "campaign_recodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_zips" ADD CONSTRAINT "coverage_zips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_zips" ADD CONSTRAINT "coverage_zips_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_original_partner_id_partners_id_fk" FOREIGN KEY ("original_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_checks" ADD CONSTRAINT "listing_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_checks" ADD CONSTRAINT "listing_checks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mls_patterns" ADD CONSTRAINT "mls_patterns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_counters" ADD CONSTRAINT "ref_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_profiles" ADD CONSTRAINT "source_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_rules" ADD CONSTRAINT "state_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_rules" ADD CONSTRAINT "state_rules_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_source_profile_id_source_profiles_id_fk" FOREIGN KEY ("source_profile_id") REFERENCES "public"."source_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_feedback_tenant_idx" ON "ai_feedback" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ai_memory_tenant_idx" ON "ai_memory" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "recodes_tenant_idx" ON "campaign_recodes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "coverage_tenant_zip_idx" ON "coverage_zips" USING btree ("tenant_id","zip5");--> statement-breakpoint
CREATE INDEX "events_tenant_created_idx" ON "events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_tenant_key_idx" ON "feature_flags" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_idx" ON "lead_notes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_status_lead_idx" ON "lead_status_history" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_tenant_dedupe_idx" ON "leads" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "leads_tenant_upload_idx" ON "leads" USING btree ("tenant_id","upload_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_partner_created_idx" ON "leads" USING btree ("tenant_id","partner_id","created_at");--> statement-breakpoint
CREATE INDEX "listing_checks_lead_idx" ON "listing_checks" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mls_patterns_tenant_key_idx" ON "mls_patterns" USING btree ("tenant_id","pattern_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "partners_tenant_idx" ON "partners" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_tenant_ref_idx" ON "partners" USING btree ("tenant_id","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_tenant_key_idx" ON "settings" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "source_profiles_tenant_idx" ON "source_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "state_rules_tenant_state_idx" ON "state_rules" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "uploads_tenant_idx" ON "uploads" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_tenant_ref_idx" ON "uploads" USING btree ("tenant_id","ref_id");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_idx" ON "users" USING btree ("tenant_id","email");