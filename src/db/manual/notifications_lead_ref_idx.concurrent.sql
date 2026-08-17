-- MANUAL, OUT-OF-TRANSACTION migration — NOT applied by `drizzle-kit migrate`.
-- Parked here (outside drizzle's `out` dir) deliberately: `CREATE INDEX CONCURRENTLY` cannot run
-- inside a transaction, and a plain `CREATE INDEX` on the now-live `notifications` table takes a
-- write-blocking ShareLock (forbidden post-launch). See ADR-0048 / DM-13, candidate C-36.
--
-- WHEN to run: when notification volume makes the (tenant_id, lead_ref) redaction lookup in
--   redactLeadCommunications (src/modules/retention/redact-lead-comms.ts) seq-scan too expensively.
--   Today `notifications` is small and the seq-scan is fine (same cost model as the other sweeps).
-- HOW to run: against prod, out-of-transaction (psql without a BEGIN, or the Supabase SQL editor),
--   under owner greenlight (Tier A — a prod change). Then verify with `pg_indexes`, NOT the drizzle
--   ledger (this is applied out-of-band and carries no snapshot — ADR-0048).
--
-- Idempotent: IF NOT EXISTS + a fixed name. If a prior CONCURRENTLY build was interrupted it can
-- leave an INVALID index — drop it first (`DROP INDEX CONCURRENTLY IF EXISTS "notifications_tenant_lead_ref_idx";`)
-- then re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_tenant_lead_ref_idx"
  ON "notifications" USING btree ("tenant_id", "lead_ref")
  WHERE "lead_ref" IS NOT NULL;
