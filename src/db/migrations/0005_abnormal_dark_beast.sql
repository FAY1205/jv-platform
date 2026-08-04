CREATE TABLE "reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reset_tokens_hash_idx" ON "reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "reset_tokens_user_idx" ON "reset_tokens" USING btree ("user_id");--> statement-breakpoint
-- RLS (SEC-01): reset_tokens is server-managed (service role). Deny-by-default —
-- no permissive policy, so any non-service (authenticated) access is refused.
ALTER TABLE "reset_tokens" ENABLE ROW LEVEL SECURITY;