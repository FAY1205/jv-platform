-- C-3 / WP-SU-18 follow-up: a `CREATE UNIQUE INDEX` takes the `_idx` suffix by repo convention
-- (`_key` is Postgres's own suffix for UNIQUE CONSTRAINT-backed indexes; this one is a plain unique
-- index, migration 0029). Rename it in place to match the convention + the schema.ts definition.
--
-- ALTER INDEX ... RENAME is metadata-only: no rebuild, no lock beyond a brief catalog update, and —
-- unlike a DROP + CREATE — never drops the uniqueness guard even momentarily. IF EXISTS keeps it a
-- no-op should a future fresh DB ever create the index as `_idx` directly.
ALTER INDEX IF EXISTS "notice_claims_identifier_kind_key" RENAME TO "notice_claims_identifier_kind_idx";
