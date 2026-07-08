CREATE TABLE "auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"ip" text,
	"kind" text NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_attempts_identifier_idx" ON "auth_attempts" USING btree ("identifier","kind","created_at");--> statement-breakpoint
CREATE INDEX "auth_attempts_ip_idx" ON "auth_attempts" USING btree ("ip","kind","created_at");--> statement-breakpoint
-- RLS (SEC-01): auth_attempts is server-managed (service role). Deny-by-default —
-- no permissive policy, so any non-service (authenticated) access is refused.
ALTER TABLE "auth_attempts" ENABLE ROW LEVEL SECURITY;