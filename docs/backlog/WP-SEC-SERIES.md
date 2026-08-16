# WP-SEC series: RLS parity + behaviour oracle + author-role pin (security trio)

Spec: RLSB-01..05, RLP-01..09, SCP-01 · Phase: CRM security-hardening · Tier: **A** (all
WPs touch `lib/scope.ts` and/or RLS migrations) · ADR: 0046 (Draft).

Source: `docs/backlog/CANDIDATES.md` C-2 (WP-RLS-PARITY, HIGH), C-23 (WP-TEN-RLS-BEHAVIOUR),
C-15 (WP-SCP-1). All three converged out of the WP-TSK / WP-KAN / WP-TAG audit-tenancy
findings. `lead_tasks_scope` (migration 0041) is the reference shape; this slice brings the
older lead-child policies up to it and proves enforcement — not just policy text.

## Why this exists (the real gap)

The app connects to Postgres as the table owner and **bypasses RLS by design** (ADR-0013);
the scoping guard (`lib/scope.ts`) is the app-layer half. RLS is the defense-in-depth half
that matters for any **non-owner** connection — the PostgREST/`authenticated` surface Supabase
exposes. Verified live (WP-TSK-1 audit-tenancy F-1): `anon`/`authenticated` hold full CRUD
grants on `leads`/`lead_notes`/`lead_tasks`, so for that surface **RLS is the only gate**.

Three concrete holes today:

1. **`lead_notes_scope` (migration 0010) is behind.** Its USING clause scopes a partner by
   lead-ownership only — **no own-org-author predicate and no `deleted_at` filter**. Because
   lead ownership MOVES on re-route (`coalesce(manual_partner_id, partner_id)`), the R-22 leak
   that 0037 closed for `lead_status_history` still exists for **notes at the DB layer**: a new
   owner can read the prior partner's notes through PostgREST. The app-layer `noteWhere` already
   carries the own-author predicate, so this is defense-in-depth drift, not a live app bug — but
   it is exactly the kind of gap RLS exists to catch.

2. **Every pre-0041 lead-child policy has a tenant-only WITH CHECK.** `leads`, `lead_notes`,
   `lead_status_history`, `listing_checks` all `with check (tenant_id = app_current_tenant())`.
   On the grant surface a partner JWT can therefore **write across ownership and across the
   PRN-13 stream wall** via PostgREST — insert a note into the admin stream, re-point a lead's
   `lead_id` on a child row, or re-route a lead by writing `manual_partner_id`. 0041 shows the
   target: WITH CHECK pins identity, stream, and in-tenant/owned references.

3. **The test suite asserts policy TEXT, never enforcement.** `isolation.test.ts`,
   `tasks-scope.test.ts`, `tags-scope.test.ts` read `pg_policies.qual`/`.with_check` and
   pattern-match the predicate. That proves a policy *says* the right thing; it cannot catch a
   policy attached to the wrong table, a missing `ENABLE ROW LEVEL SECURITY`, a `FORCE`-less
   owner path, or an `app_current_*()` helper that returns NULL for an anon JWT. There is no
   oracle that runs a query **as a non-owner role** and asserts denial.

4. **`ownAuthors` has no role predicate** (C-15). Both `noteWhere` and `taskWhere` resolve
   "my org's authors" as `users WHERE tenant_id = ? AND partner_id = ?`, and `users.partner_id`
   carries no role invariant. An admin row with a stray `partner_id` would have its
   admin-authored rows counted as that partner org's — crossing PRN-13 in a READ path. Latent
   (nothing sets `partner_id` on an admin today), but `resolveAssignee` already had to add the
   role check locally for this exact reason (WP-TSK-2 audit-tenancy F-4), and WP-TSK-6 promoted
   `taskWhere` from visibility to **delivery authorization** (it decides who gets email), raising
   the cost of the gap.

## WP breakdown

| WP | Scope | Tier | Depends |
|----|-------|------|---------|
| WP-SEC-1 | **RLS behaviour oracle** (C-23): shared `tests/helpers/rls.ts` that runs reads/writes as a non-owner role under set JWT claims; retrofit `isolation` / `tasks-scope` / `tags-scope` to assert **enforcement** of the current (correct) policies. | A | — |
| WP-SEC-2 | **RLS parity + author-role pin** (C-2 + C-15): migration 0044 brings `leads` / `lead_notes` / `lead_status_history` / `listing_checks` to the 0041 two-half standard, adds the own-org-author + `deleted_at` predicates to `lead_notes` USING, pins `role='partner'` in the note/task author subqueries; `lib/scope.ts` `noteWhere`/`taskWhere` get the same role pin. Proven by new behaviour tests using the WP-SEC-1 oracle. | A | WP-SEC-1 merged |

**Order rationale:** the oracle lands first so WP-SEC-2's parity fixes are written test-first —
the behaviour tests assert the *desired* end-state and FAIL red against today's policies (notes
cross-author read, cross-stream write), then go green when 0044 lands. C-8 (fold the
distribution hold into `taskWhere`'s partner arm + RLS) **pairs** with this slice but is NOT in
it — it is a behavioural change to the hold gate's location with its own test surface; kept
separate to keep each diff reviewable. Noted as the natural follow-on.

Reviews: each WP gets `pr-reviewer` + `audit-tenancy` (both touch scope/RLS). WP-SEC-2 also
gets `audit-security` (grant-surface reasoning). Full local integration suite before each PR
(both touch shared modules: `lib/scope.ts` and the isolation suites).

---

## WP-SEC-1 — RLS behaviour oracle (C-23)

- **RLSB-01 — Non-owner harness.** A shared helper (`tests/helpers/rls.ts`) opens a
  transaction, `set local`s the role to `authenticated` and `request.jwt.claims` to a supplied
  `{sub, app_metadata:{tenant_id, role, partner_id}}`, runs a caller-supplied read or write, and
  **rolls back**. API: `asRole(db, claims, fn)` returns whatever `fn` reads (denial on a read =
  zero rows through the USING filter); `probeWrite(db, claims, write, effect)` measures whether a
  write ACTUALLY took effect. `probeWrite` runs `write` WITHOUT `RETURNING` (a RETURNING clause
  re-applies the SELECT/USING policy to the new row, so a write a weak WITH CHECK allows to
  persist would still raise 42501 on RETURNING and be misread as denied), then runs `effect` with
  RLS `reset` to the table owner to count what persisted; denial = the write was blocked (42501)
  OR nothing was effected. SQLSTATE is read via the shared `pgErrorCode` (`lib/db/pg-error.ts`),
  which walks drizzle's error-wrap chain. Tests assert against the returned `{denied, blocked,
  effected}` inline. The app path (owner connection) is untouched — this is deliberately the
  **non-owner** surface, the only reason these policies exist. Self-skips without `DATABASE_URL`.
- **RLSB-02 — Helper existence probe.** The harness asserts the `authenticated` role exists and
  that `app_current_tenant()`/`app_current_role()`/`app_current_partner()`/`app_current_user()`
  resolve the set claims inside the transaction (a NULL-returning helper would make every policy
  silently deny and mask a real regression — the probe distinguishes "denied by policy" from
  "denied because claims didn't bind").
- **RLSB-03 — Tenant isolation, enforced.** Under tenant-A partner claims, a read of a
  tenant-B row returns zero rows; an attempt to INSERT a `lead_tasks`/`lead_notes` row with
  tenant-B `tenant_id` is refused. Retrofit into `isolation.test.ts` alongside the existing
  text assertions (text assertions stay — necessary, just not sufficient).
- **RLSB-04 — Stream + ownership, enforced.** Under partner-X claims: cannot read partner-Y's
  tasks/notes; cannot read admin-stream rows; cannot INSERT a row into the admin stream or onto
  a lead X does not own. Under admin claims: cannot read partner-stream rows. Exercised on
  `lead_tasks` (already correct — proves the oracle catches nothing false) and `lead_notes`
  (will be RED until WP-SEC-2; those legs are marked `.fails`/skipped with a WP-SEC-2 breadcrumb,
  or deferred to WP-SEC-2's suite — see RLP-08).
- **RLSB-05 — RLS-enabled sweep.** A repo-wide probe asserting every table carrying a
  tenant-scoped policy has `relrowsecurity = true` AND at least one policy, executed once. Backs
  the ADR-0043 auto-enable trigger with a test that fails loudly if a future table ships a
  policy but forgets the enable.

**Non-goals:** no change to any policy or to `lib/scope.ts`; no new production code. Pure test
infrastructure. If a retrofitted enforcement assertion fails against a *current* policy that the
text assertion passed, that is a real finding → it becomes a WP-SEC-2 line, not a silently-
relaxed test.

---

## WP-SEC-2 — RLS parity + author-role pin (C-2 + C-15)

Migration **0044** (hand-authored SQL, like 0037; journal entry added manually with a `when`
above 0043's `1786830148923`). Every policy dropped + recreated (Postgres has no
`CREATE OR REPLACE POLICY`). Applied to the test DB by hand after authoring (drizzle skips
already-ledgered entries; this is a new entry so `db:migrate` applies it, but the behaviour
tests need it present before the run). Prod applies on merge (migrate-on-merge).

### Target policy shapes (all mirror `lead_tasks_scope`, 0041)

- **RLP-01 — `leads_scope` WITH CHECK.** From tenant-only to:
  `tenant AND (admin OR (partner AND coalesce(manual_partner_id, partner_id)=app_current_partner() AND deleted_at is null))`.
  A partner can no longer write/re-point a lead they don't own; admin retains full in-tenant
  write (incl. recall). USING unchanged (already effective-owner, 0010).
- **RLP-02 — `lead_notes_scope` USING.** Add the two missing predicates so it matches 0041's
  read half: partner arm becomes `... AND lead_id IN (own + live + tenant-pinned leads) AND
  author_user_id IN (own-org authors: tenant + partner_id=me + role='partner')`. Closes the
  R-22-for-notes DB-layer read leak.
- **RLP-03 — `lead_notes_scope` WITH CHECK.** From tenant-only to identity+stream+lead pinned:
  `tenant AND author_user_id=app_current_user() AND ((admin&admin_role AND lead_id IN tenant-leads)
  OR (partner&partner_role AND lead_id IN own+live leads))`. (Notes have no assignee column.)
- **RLP-04 — `lead_status_history_scope`.** USING keeps its 0037 author logic but the inner
  leads subquery gains the tenant pin + `deleted_at is null` (today it is
  `select id from leads where coalesce(...)=app_current_partner()` — under-scoped). WITH CHECK
  from tenant-only to: `tenant AND (admin OR (partner AND lead_id IN own+live leads)) AND
  (changed_by_user_id is null OR changed_by_user_id = app_current_user())` — pins the author on
  the authenticated write path; the null arm preserves service-role/system entries (which bypass
  RLS anyway). The author READ predicate `(role='admin' OR partner_id=me)` stays as-is
  (deliberate: an admin's inline status change is visible to the current owner — status is one
  shared field, not the two-stream notes model; **not** subject to SCP-01).
- **RLP-05 — `listing_checks_scope`.** No author column (system MLS check, belongs to the
  lead). USING inner subquery gains tenant pin + `deleted_at is null`. WITH CHECK from
  tenant-only to `tenant AND (admin OR (partner AND lead_id IN own+live leads))` — mirrors USING
  ownership; in practice only the service role writes these, but WITH CHECK ≥ USING is the
  standard.
- **RLP-06 — `lead_tasks_scope` author-role pin (C-15 half).** The own-org author subquery in
  BOTH policy halves gains `AND role='partner'`, matching SCP-01 in `lib/scope.ts`.

### App layer

- **SCP-01 — `ownAuthors` role pin.** `noteWhere` and `taskWhere` (`lib/scope.ts`): the
  `ownAuthors` subquery gains `eq(users.role, 'partner')`. `ownStatusAuthorScope` is
  deliberately excluded (its `role='admin' OR partner_id=me` is a different, intentional
  semantic). One-line change each; the RLS counterparts are RLP-02/RLP-06.

### Tests (behaviour + text, via the WP-SEC-1 oracle)

- **RLP-07 — Notes read parity, enforced.** As partner-Y (new owner of a re-routed lead),
  reading via the non-owner role returns zero of partner-X's notes; before 0044 this leg is RED
  (proves the fix). As partner-X, an INSERT of a note into the admin stream / onto an unowned
  lead is refused.
- **RLP-08 — Write-half enforcement, every table.** For each of `leads`/`lead_notes`/
  `lead_status_history`/`listing_checks`: a partner-role write that violates the new WITH CHECK
  (cross-stream, cross-owner, re-point) raises `42501` / affects zero rows; the legitimate write
  succeeds.
- **RLP-09 — SCP-01 author-role, enforced.** A user row with `role='admin'` but a stray
  `partner_id` set: its admin-authored note/task does NOT appear in that partner org's read
  (both the `taskWhere`/`noteWhere` app path and the RLS path). Fixture-only admin-with-partner_id
  row, cleaned up after.
- Text assertions in the existing suites updated to the new `app_current_tenant()` counts
  (subquery tenant pins added → the counted-occurrences assertions in `tasks-scope`/`isolation`
  move).

**Non-goals:** C-8 (hold into `taskWhere`) — separate WP. No new columns, no schema change
beyond policies. No change to the admin arms' deliberate asymmetries (admin keeps work items on
recalled leads; admin status entries stay visible to owners). No portal query changes.

## ADR-0046 (Draft) — the durable rules this slice encodes

1. **WITH CHECK ≥ USING** on tenant / stream / ownership for every tenant-scoped policy — a
   tenant-only WITH CHECK is not a backstop where table grants exist.
2. **Child-table lead lookups are composite-scoped**: `lead_id IN (select id from leads where
   tenant_id = app_current_tenant() AND <ownership> AND deleted_at is null)` — never a bare
   `lead_id IN (select id from leads where <ownership>)`.
3. **New free-text lead-child columns** join the void/retention redaction path in the WP that
   makes them writable.
4. **RLS is tested by enforcement, not text**: every policy claim has a non-owner-role behaviour
   test (the WP-SEC-1 oracle) in addition to the `pg_policies` text probe.
5. **Overlay-dependent predicates get a revert-leg test** (re-route then revert; the leg a naive
   "ownership follows the lead" regression breaks).
