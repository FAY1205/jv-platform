-- WP-KAN-1a (C-16): covering index for the "latest status per lead" probe
-- (`where lead_id = ? order by created_at desc, id desc limit 1`), used by the leads
-- list/board, portal list, and global search. Supersedes lead_status_lead_idx (lead_id) —
-- the new index leads with the same column, so the lead_id FK + equality stay covered.
-- DM-13: a plain (non-CONCURRENTLY) DROP+CREATE runs inside the migrate transaction. That is
-- safe HERE only because lead_status_history is tiny in prod today (~1 row) so the ShareLock is
-- sub-millisecond. If it were already large, this would have to be a CONCURRENTLY out-of-tx step
-- (src/db/manual/) instead — we create the index now, while the table is small, exactly so it is
-- in place before the volume this index exists to serve arrives.
DROP INDEX "lead_status_lead_idx";--> statement-breakpoint
CREATE INDEX "lead_status_lead_created_idx" ON "lead_status_history" USING btree ("lead_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);