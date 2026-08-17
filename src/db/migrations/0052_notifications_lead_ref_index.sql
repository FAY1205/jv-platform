-- C-36: partial index for the void/purge notification redaction lookup (tenant_id, lead_ref).
-- DM-13: a plain (non-CONCURRENTLY) CREATE INDEX runs inside the migrate transaction. Safe HERE
-- because notifications is tiny in prod today (~6 rows) so the ShareLock is sub-millisecond — placed
-- now, while small, so it's in place before end-user volume arrives (unpredictable). Supersedes the
-- parked CONCURRENTLY step (src/db/manual/notifications_lead_ref_idx.concurrent.sql), now removed.
CREATE INDEX "notifications_tenant_lead_ref_idx" ON "notifications" USING btree ("tenant_id","lead_ref") WHERE "notifications"."lead_ref" is not null;