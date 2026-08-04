CREATE TABLE "signup_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"used_by_tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "signup_codes_hash_idx" ON "signup_codes" USING btree ("code_hash");--> statement-breakpoint
-- RLS (SEC-01): signup_codes is server-managed (service role). Deny-by-default —
-- no permissive policy, so any non-service (authenticated) access is refused.
ALTER TABLE "signup_codes" ENABLE ROW LEVEL SECURITY;