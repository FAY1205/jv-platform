-- C-13 / WP-RET-3a: give notifications a nullable lead_ref (refId string, mirrors
-- email_outbox.meta.leadRef) so the void/purge paths can find + redact a soft-deleted lead's
-- notifications (the task_due title embeds the task free text = seller PII). No index on it (yet):
-- CREATE INDEX on the now-live table takes a write-blocking ShareLock (forbidden post-launch), and
-- drizzle transactional migrate can't run CONCURRENTLY. notifications is small → seq-scan is fine.
-- Add the partial index via CONCURRENTLY out-of-transaction when volume warrants (candidate C-36).
ALTER TABLE "notifications" ADD COLUMN "lead_ref" text;
