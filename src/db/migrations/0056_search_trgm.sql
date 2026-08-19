-- WP-N4 / SRCH-08 (ADR-0051) — adopt pg_trgm so global search can RANK its Ctrl-K results by
-- trigram similarity server-side (PRN-15) instead of handing the overlay an arbitrary
-- recency order, and so the substring ILIKEs the three search surfaces run have an index
-- that can actually serve them. This supersedes the "no new extension" HALF of SRCH-03
-- (ADR-0051); the MATCHING semantics stay exact-substring ILIKE — no fuzzy/typo tolerance.
--
-- ⚠️ EXTENSION SCHEMA PLACEMENT (the trap this migration is written around).
-- `gin_trgm_ops` (DDL, below) and `word_similarity()` (runtime, modules/search/queries.ts)
-- are both resolved through the connection's search_path, so WHERE the extension lands
-- decides whether the app's SQL parses at all. The two environments differ:
--   • Supabase (prod + `jv-platform-test`): role `postgres` runs with
--     search_path = "$user", public, extensions  and current_schema() = public.
--   • CI (vanilla postgres:16, superuser): search_path = "$user", public — there is NO
--     `extensions` schema at all.
-- An unqualified `CREATE EXTENSION` installs into the CURRENT schema, i.e. `public` in BOTH
-- environments — one placement, on the search_path everywhere, so the identical SQL parses in
-- CI, on the test DB and in prod. `WITH SCHEMA extensions` was rejected precisely because it
-- cannot run on CI (no such schema) and would leave prod running SQL that CI never proves.
-- `IF NOT EXISTS` also makes this a no-op on any database where Supabase has already installed
-- pg_trgm into `extensions` — that placement is on the Supabase search_path too, so both
-- outcomes resolve. Known, accepted trade-off: Supabase's `extension_in_public` advisor will
-- flag this; pg_trgm exposes pure text functions only (no data access, no elevated rights).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- The four lead text columns + partners.name the search builders (modules/search/match.ts)
-- run `ILIKE '%…%'` against, and that `word_similarity()` ranks on. A GIN trgm index is the
-- only index type that can serve a LEADING-wildcard LIKE; btree cannot.
--
-- DM-13: plain (non-CONCURRENTLY) CREATE INDEX, so it runs inside the migrate transaction —
-- safe here for the same reason as 0051/0052/0055 (C-36): `leads` is ~300 rows and `partners`
-- a handful in prod today, so the ShareLock is sub-millisecond. Placed now, while the tables
-- are small, precisely so they are already in place before end-user volume arrives. If these
-- tables are ever large at migrate time, the deferred out-of-transaction CONCURRENTLY path
-- (src/db/manual/) is the alternative.
--
-- DELIBERATELY NOT INDEXED: leads.zip, leads.ref_id, leads.phone_norm. They are short
-- identifier columns — a trigram index on a 5-char ZIP is mostly overhead, and at current
-- scale the planner's seq scan is fine. Revisit at the N12 ~80k-leads/tenant trigger, where
-- the identifier columns want their own (btree/prefix) treatment rather than trigrams.
CREATE INDEX IF NOT EXISTS "leads_seller_first_trgm_idx" ON "leads" USING gin ("seller_first" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_seller_last_trgm_idx" ON "leads" USING gin ("seller_last" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_address_trgm_idx" ON "leads" USING gin ("address" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_city_trgm_idx" ON "leads" USING gin ("city" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partners_name_trgm_idx" ON "partners" USING gin ("name" gin_trgm_ops);
