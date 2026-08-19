# ADR-0052: `notification_pref_overrides` cascades on subject delete

- **Status:** Accepted
- **Date:** 2026-08-19
- **Phase / WP:** WP-NF2 (Notifications v2) / PR A — NTF-10, migration 0057

## Context

Migration 0057 adds `notification_pref_overrides`: one row per SUBJECT — either a user seat
(`user_id`) or a partner org (`partner_id`), never both (`CHECK num_nonnulls(...) = 1`). The row
holds that subject's preference overlay plus its unsubscribe token (NTF-13).

Every other FK in `src/db/schema.ts` is `ON DELETE no action`. That default is deliberate and
load-bearing: most child rows in this system are RECORDS of something that happened
(`notifications`, `lead_status_history`, `audit_log`, `email_outbox`), and a record must not
evaporate because a parent row was removed — the schema comment on `notifications` spells this
out, and Phase C's seat lifecycle deactivates seats rather than deleting them precisely so
authorship survives.

An overlay row is not that kind of row. It is a pure child: a statement of *current* preference
that has no meaning, no history value, and no reader once its subject is gone. Left behind by a
`no action` FK it becomes worse than useless — it pins the parent, so the delete fails outright.
That surfaced immediately: several existing integration suites hard-delete `users`/`partners` in
their `cleanup()` helpers, and the new FK blocked the teardown with a 23503.

## Decision

Use `ON DELETE CASCADE` on **the two SUBJECT legs only** — `user_id` and `partner_id`.
`tenant_id` keeps the house `no action` pattern.

- A hard-deleted subject takes its preferences and its unsubscribe token with it. There is
  nothing to orphan and nothing to audit.
- Cascading `tenant_id` was rejected: tenant deletion is not a routine operation here, and making
  it quietly cheaper is the opposite of what the `no action` pattern is for.
- Soft-deletes are unaffected — a revoked partner or a deactivated seat keeps its row, so it
  keeps its overlay, which is correct: reactivation should not silently resubscribe someone.

### Where each leg actually fires

- **`user_id` — live today, narrowly.** Users are hard-deleted only PRE-ACTIVATION: the
  dev/test `deprovisionAdmin` path and the signup sweep's abandoned, never-verified signups.
  Both are accounts that never reached a working session, so cascading their preferences is
  exactly right. Test teardown is the other real caller.
- **`partner_id` — FORWARD-LOOKING.** There is **no partner hard-delete path in the application
  today**: partners are soft-deleted (`partners.deleted_at`, DM-09) and deactivation goes through
  `deactivatePartner`, which sets status/`deleted_at` and never issues a `DELETE`. This leg
  therefore fires only for test teardown and for any future purge path. It is declared now so
  that a purge added later cannot be blocked by, or silently strand, a preference row.

## Consequences

- **Easier:** the existing suites' teardown works untouched; a future tenant/partner purge job
  does not need to learn about this table; there is no orphan-sweep to write or forget.
- **Harder / accepted:** this table diverges from the codebase's `no action` habit, so a reader
  who has internalised that pattern will find it surprising — hence this ADR, referenced from the
  schema comment and the migration.
- **What would reopen it:** if an overlay row ever gains audit significance — e.g. a compliance
  requirement to prove *when* a person unsubscribed — then it stops being a pure child and the
  cascade becomes wrong. The fix at that point is a separate append-only consent log, not a
  change of FK action; the cascade should be revisited in the same breath.
- **Follow-up:** none. The partner leg is inert until a hard-delete path exists; if one is added,
  that WP should confirm the intended semantics here rather than assume them.
