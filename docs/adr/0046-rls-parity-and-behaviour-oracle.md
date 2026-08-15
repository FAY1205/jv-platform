# ADR-0046: RLS parity — WITH CHECK ≥ USING, composite-scoped child lookups, and an enforcement oracle

- **Status:** Draft (2026-08-16)
- **Date:** 2026-08-16
- **Phase / WP:** CRM security-hardening / WP-SEC-1 + WP-SEC-2 (RLSB-01..05, RLP-01..09, SCP-01)

## Context

The app connects to Postgres as the table owner and bypasses RLS by design (ADR-0013);
`lib/scope.ts` is the app-layer boundary. RLS is the second half — the one that matters for the
`authenticated`/`anon` PostgREST surface Supabase exposes, where table CRUD grants exist
(verified live, WP-TSK-1 audit-tenancy F-1). On that surface RLS is the only gate.

The lead-child policies drifted. `lead_tasks_scope` (0041) was built to the full standard —
two-stream USING, and a WITH CHECK that pins author identity, stream, and in-tenant/owned
references. The older policies were not: `leads`/`lead_notes`/`lead_status_history`/
`listing_checks` all carry a tenant-only WITH CHECK (0010), and `lead_notes_scope`'s USING never
got the own-org-author + `deleted_at` predicates that 0037 gave status history — so the same
R-22 re-route leak that 0037 closed for status entries is still open for **notes at the DB
layer**. Meanwhile the whole test suite asserts policy TEXT (`pg_policies.qual`/`.with_check`
pattern matching) and never executes a policy as a non-owner role — it proves a policy *says*
the right thing, not that Postgres *enforces* it.

Two different mistakes made this easy to miss: treating a tenant-only WITH CHECK as "good
enough" because reads were correctly scoped, and treating a text assertion as proof of
enforcement.

## Decision

1. **WITH CHECK ≥ USING.** Every tenant-scoped policy pins, on writes, at least what it pins on
   reads: tenant, stream (`author_role`), and ownership. A tenant-only WITH CHECK is not a
   backstop wherever table grants exist — it lets a partner JWT write across the PRN-13 stream
   wall and across ownership through PostgREST. `lead_tasks_scope` is the reference shape.

2. **Child-table lead lookups are composite-scoped.** A lead-child policy resolves ownership as
   `lead_id IN (select id from leads where tenant_id = app_current_tenant() AND <ownership> AND
   deleted_at is null)` — never a bare `lead_id IN (select id from leads where <ownership>)`.
   The tenant pin inside the subquery is load-bearing (partner_id is a UUID, but scoping on
   global uniqueness is not scoping); the `deleted_at` filter keeps a partner's owned-set free of
   recalled leads so child reads never lean on a parent join to filter deletes (DM-09b).

3. **The own-org-author predicate is role-pinned** (`role='partner'`) in the note/task author
   subqueries, in BOTH `lib/scope.ts` and RLS. `users.partner_id` carries no role invariant, so
   an admin row with a stray `partner_id` must not be counted into a partner org's authored set
   (SCP-01). The status-history author predicate (`role='admin' OR partner_id=me`) is a
   DIFFERENT, intentional semantic — admin status changes stay visible to the current owner — and
   is explicitly NOT changed.

4. **RLS is tested by enforcement, not text.** A shared non-owner-role oracle
   (`tests/helpers/rls.ts`) sets `role authenticated` + JWT claims in a rolled-back transaction,
   runs a read/write, and asserts the row filter / `42501` denial. Every policy claim gets a
   behaviour test in addition to — not instead of — the `pg_policies` text probe. The text probe
   stays: it is cheap and localizes a regression to a predicate; the behaviour test proves the
   predicate is attached, enabled, and evaluated against real claims. A helper that returns NULL
   for unbound claims would make every policy silently deny, so the oracle first proves the
   claims bind (RLSB-02), distinguishing "denied by policy" from "denied because nothing bound".

5. **Overlay-dependent predicates get a revert-leg test.** Any predicate that depends on
   `coalesce(manual_partner_id, partner_id)` is exercised re-route → revert, the leg a naive
   "ownership follows the lead" regression breaks (the WP-TSK / ADR-0044 precedent).

### What this ADR does NOT change

- The admin arms' deliberate asymmetries: admin keeps its own work items visible on a recalled
  lead (no `deleted_at` filter on the admin read arm); admin status entries stay visible to the
  current lead owner.
- The service-role write path. System-authored rows (`lead_status_history.changed_by_user_id
  IS NULL`, `listing_checks`) are written as the owner and bypass RLS; the new WITH CHECK arms
  admit them via a null-author arm rather than forbidding them.
- C-8 (folding the distribution hold into `taskWhere`'s partner arm and RLS) — a behavioural
  change to the hold gate's location, tracked separately.

## Consequences

Easier: one durable standard for every future lead-child table (the four rules above are the
checklist a new policy is measured against); a real oracle means the next scope change is proven,
not asserted. Harder: 0044 drops and recreates five policies in one migration, so the migration is
long and every recreate must be verified against `lead_tasks_scope`; the behaviour oracle adds a
non-owner connection path to the integration suite that depends on the `authenticated` role and
the table grants existing in the test DB (they do — same Supabase surface as prod).

Reopened if: a lead-child table needs a WITH CHECK that legitimately cannot mirror its USING (none
foreseen); the grant surface is removed (RLS stops being load-bearing and these become pure
defense-in-depth — the standard still holds but the urgency drops); or roles beyond admin/partner
arrive (the two-arm shape generalizes but the author predicates would need revisiting).
