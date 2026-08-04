CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"code_hash" text NOT NULL,
	"pepper" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tos_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "otp_challenges_identifier_idx" ON "otp_challenges" USING btree ("identifier","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tos_acceptances_user_version_idx" ON "tos_acceptances" USING btree ("user_id","version");--> statement-breakpoint
-- RLS (SEC-01): both are server-managed (service role). Deny-by-default — no
-- permissive policy, so any non-service (authenticated) access is refused.
ALTER TABLE "otp_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tos_acceptances" ENABLE ROW LEVEL SECURITY;