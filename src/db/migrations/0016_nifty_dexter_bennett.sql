-- WP-G (NTF-03): add a nullable HTML alternative to the email outbox so branded digest
-- HTML (mockup 11) travels to the drain. Additive + nullable:
--   * RLS   - unchanged: email_outbox is deny-by-default / service-role (migration 0008); no policy touches this column.
--   * Index - none: `html` is never a query predicate (the outbox is drained by status + next_attempt_at).
--   * Seed  - none: existing rows stay NULL; the drain falls back to text-only.
ALTER TABLE "email_outbox" ADD COLUMN "html" text;