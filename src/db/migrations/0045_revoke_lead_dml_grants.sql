-- WP-SEC-3 / SEC3-01 (ADR-0046 Decision-6, audit-security F-1): least privilege on the
-- authenticated/PostgREST surface. WITH CHECK parity (0044) hardened the write policies, but
-- RLS CANNOT gate DELETE (USING alone decides which rows a DELETE may touch — a partner can
-- hard-delete their own leads/notes/tasks/status/listing rows, defeating the void model's
-- soft-delete, PRN-05/DM-08) NOR column scope (a partner could UPDATE non-ownership columns of
-- an owned lead — rawJson, score_total, mls_status — since WITH CHECK only re-checks
-- tenant/owner/deleted_at). The durable fix is not more RLS: the app connects as the table
-- OWNER (ADR-0013) and never uses these grants — verified live: there is no client-side
-- `supabase.from()` anywhere; all table access goes through API routes on the owner connection.
-- So revoke write DML from anon/authenticated. RLS then becomes pure defense-in-depth (its
-- intended role) rather than the sole, partial gate.
--
-- SELECT is deliberately RETAINED: the read policies (0001/0010/0037/0044) remain the gate, and
-- revoking read is a larger, separately-verified claim (the portal never reads via PostgREST
-- today, but keeping SELECT costs nothing and preserves the defense-in-depth read backstop).
-- service_role and the owner keep every grant. REVOKE of an absent privilege is a no-op, so this
-- is idempotent and safe to re-run.

-- TRUNCATE is included: it is not PostgREST-reachable (no REST verb) but it is a whole-table
-- wipe that ignores RLS entirely, so least privilege revokes it from these roles too.
--
-- Table list is the source of truth mirrored by LEAD_FAMILY_TABLES in tests/helpers/rls.ts
-- (the oracle's in-txn grant + the rls-grants tests). NOTE (WP-SEC-4 candidate C-28): Supabase's
-- schema-level default privileges (pg_default_acl on `public`) auto-grant FULL DML to
-- anon/authenticated on every NEW table, so this per-table revoke does not cover future tables —
-- the durable fix is `ALTER DEFAULT PRIVILEGES` + a repo-wide revoke, a broader owner decision.
revoke insert, update, delete, truncate on leads from anon, authenticated;--> statement-breakpoint
revoke insert, update, delete, truncate on lead_notes from anon, authenticated;--> statement-breakpoint
revoke insert, update, delete, truncate on lead_tasks from anon, authenticated;--> statement-breakpoint
revoke insert, update, delete, truncate on lead_status_history from anon, authenticated;--> statement-breakpoint
revoke insert, update, delete, truncate on listing_checks from anon, authenticated;
