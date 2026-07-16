CREATE TABLE "signup_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "signup_verifications_hash_idx" ON "signup_verifications" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "signup_verifications_user_idx" ON "signup_verifications" USING btree ("user_id");--> statement-breakpoint
-- RLS (SEC-01): signup_verifications is server-managed (service role). Deny-by-default —
-- no permissive policy, so any non-service (authenticated) access is refused.
ALTER TABLE "signup_verifications" ENABLE ROW LEVEL SECURITY;