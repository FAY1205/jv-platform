CREATE TABLE "notice_claims" (
	"identifier" text NOT NULL,
	"kind" text NOT NULL,
	"notified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notice_claims_identifier_kind_pk" PRIMARY KEY("identifier","kind")
);
--> statement-breakpoint
-- RLS (SEC-01): notice_claims is server-managed (service role). Deny-by-default —
-- no permissive policy, so any non-service (authenticated) access is refused. WP-SU-16.
ALTER TABLE "notice_claims" ENABLE ROW LEVEL SECURITY;
