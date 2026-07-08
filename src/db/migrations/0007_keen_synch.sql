CREATE TABLE "trusted_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"partner_id" uuid,
	"token_hash" text NOT NULL,
	"device_label" text,
	"ip" text,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"rotated_to" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_devices_hash_idx" ON "trusted_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "trusted_devices_family_idx" ON "trusted_devices" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "trusted_devices_user_idx" ON "trusted_devices" USING btree ("tenant_id","user_id");--> statement-breakpoint
-- RLS (SEC-01): server-managed (service role). Deny-by-default — no permissive
-- policy; the app-layer scope guard enforces self/admin visibility (ACC-02).
ALTER TABLE "trusted_devices" ENABLE ROW LEVEL SECURITY;