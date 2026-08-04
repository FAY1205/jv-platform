-- WP-SU-8: backs the global rolling-hour signup ceiling (kind-leading, so the scan stays
-- inside one endpoint's rows). Deliberately NOT CONCURRENTLY: this ships before production
-- is provisioned, so it applies to an empty table (same precedent as migration 0017, recorded
-- in docs/GO-LIVE-CHECKLIST.md). DO NOT copy this pattern for a populated auth_attempts after
-- launch -- CREATE INDEX takes a ShareLock that blocks writes for its duration; use
-- CREATE INDEX CONCURRENTLY, outside a transaction, instead.
CREATE INDEX "auth_attempts_kind_created_idx" ON "auth_attempts" USING btree ("kind","created_at");