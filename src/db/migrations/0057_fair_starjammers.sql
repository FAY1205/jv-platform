CREATE TABLE "notification_pref_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"partner_id" uuid,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_id" text NOT NULL,
	"token_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_pref_overrides" ADD CONSTRAINT "notification_pref_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_pref_overrides" ADD CONSTRAINT "notification_pref_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_pref_overrides" ADD CONSTRAINT "notification_pref_overrides_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notif_pref_overrides_tenant_idx" ON "notification_pref_overrides" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_pref_overrides_token_idx" ON "notification_pref_overrides" USING btree ("token_id");--> statement-breakpoint
-- NTF-10: exactly ONE subject per row — a user seat OR a partner org, never both, never
-- neither. Resolution differs per subject kind (a partner-ORG overlay applies the EMAIL leg
-- only, since an org has no in-app surface), so a row claiming both has no defined meaning.
-- Same posture as the 0054 SCP-08 CHECK: the invariant lives in the database, not only in
-- the writer. It also makes the two partial uniques below exhaustive.
ALTER TABLE "notification_pref_overrides"
  ADD CONSTRAINT "notif_pref_overrides_one_subject_chk"
  CHECK (num_nonnulls("user_id", "partner_id") = 1);--> statement-breakpoint
-- One overlay row per subject. PARTIAL uniques, kept as raw SQL (the
-- partners_one_house_per_tenant_idx precedent in 0031 — drizzle's schema tracking does not
-- own partial uniques): each index covers only its own subject kind, so the NULL half of the
-- CHECK above can never collide across kinds.
CREATE UNIQUE INDEX IF NOT EXISTS "notif_pref_overrides_tenant_user_idx"
  ON "notification_pref_overrides" ("tenant_id", "user_id")
  WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notif_pref_overrides_tenant_partner_idx"
  ON "notification_pref_overrides" ("tenant_id", "partner_id")
  WHERE "partner_id" IS NOT NULL;--> statement-breakpoint
-- RLS (SEC-01): notification_pref_overrides is SERVER-MANAGED (service role) — read by the
-- fan-out paths, written by /api/me/notification-prefs and the tokenized /api/unsubscribe
-- endpoint, all server-side. Deny-by-default: NO permissive policy, so any non-service
-- (authenticated) access is refused. Exactly the email_outbox posture in 0008. The row carries
-- the unsubscribe token_secret, so a client-readable policy would hand every seat of a tenant
-- the capability to unsubscribe its colleagues.
ALTER TABLE "notification_pref_overrides" ENABLE ROW LEVEL SECURITY;
