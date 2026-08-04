# WP-F1 — Self-scope correlated latest-status subqueries (tenancy defence-in-depth) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit tenant scoping to the correlated `lead_status_history` subqueries used in the leads list queries — defence-in-depth per **ADR-0013** (app-layer `scope.ts` is the only isolation boundary; no Postgres RLS). This is the deferred **audit-tenancy F-1** from WP-PW-3, plus a documented engineering rule so the pattern can't recur.

**Premise correction (surface at sign-off):** F-1 was filed as "make the portal `LATEST_STATUS` self-scoped, symmetric to admin." On inspection, **the admin subqueries are ALSO unscoped** — a full sweep found exactly three correlated child subqueries, all correlating only on the (globally-unique) `leads.id` with no `tenant_id`:
- `src/modules/portal/queries.ts:64` — portal `LATEST_STATUS`
- `src/modules/leads/queries.ts:49` — admin `LATEST_STATUS`
- `src/modules/leads/queries.ts:50` — admin `LATEST_AT`

So "symmetric to admin" means hardening **all three**, not making portal match an already-hardened admin. Doing only the portal one would leave the new engineering rule immediately violated by admin.

**Why it's provably safe today (and why we still harden):** each subquery correlates on `lead_id = leads.id`, and `leads.id` is a globally-unique PK; the outer query is already tenant/partner-scoped, and FK integrity guarantees a lead's history rows share its tenant — so no cross-tenant row can match. The change is therefore **behavior-preserving** (identical results); its value is defence-in-depth (a second, independent scope predicate) + the codified rule.

**Tech Stack:** Next 16 (App Router, TS), Drizzle (Postgres), Vitest + node (integration against the local DB).

## Global Constraints

- **PRN-08 / ADR-0013.** The added scoping uses the canonical `tenantWhere(schema.leadStatusHistory, scope)` helper (NOT a hand-rolled `tenant_id = …`), interpolated into the raw `sql` subquery — exactly the proven pattern in `partner-performance.ts` (`histTenant = tenantWhere(schema.leadStatusHistory, scope)` → `where ${histTenant} and lead_id in (...)`). Never string-concatenate the tenant id.
- **Behavior-preserving.** Results (rows, order, counts, status/modified values) must be byte-identical before/after — this is a redundant predicate over the same rows. The regression guard is the EXISTING suites staying green (portal `PW3-01..06` sort/filter; admin leads list/sort/status/detail tests). No functional change.
- **No scope-guard change.** `scope.ts` / `tenantWhere` themselves are UNTOUCHED — this only threads `scope` into the subquery builders that were module-level constants.
- **No new query, no schema change.** Same two `listLeads`/`listPartnerLeads` reads; only their correlated subqueries gain a predicate.
- **Minimal blast radius.** Self-scope **in place** in each file (mirroring the existing independent duplication) — do NOT introduce a shared cross-module (leads ↔ portal) helper in this WP (that would be an architecture change / audit-architecture concern; log it as a deferred candidate instead).
- **Test names carry requirement IDs** (`F1-…`). Integration runs against the local DB (`.env.local`); vitest SERIAL (`--no-file-parallelism`).
- **ONE `feat` commit** (+ the `docs` plan commit) after explicit owner "go"; push after a separate "go".

---

## Design decision for owner sign-off — two questions

1. **Scope of the hardening:** the recommended (and consistent) fix self-scopes **all three** subqueries (portal + both admin). The alternative is portal-only (leaves admin inconsistent with the new rule — not recommended). **Recommend: all three.**
2. **The rule's home:** codify "correlated child subqueries in a WHERE/ORDER BY must carry their own tenant scope (not rely solely on a correlation key)" in **`docs/ENGINEERING_STANDARDS.md`** (the data/tenancy section the audit agents read). Whether to **elevate it to a numbered PRN** in `CLAUDE.md`'s non-negotiables is the owner's call (a spec change). **Recommend: document in ENGINEERING_STANDARDS now; owner decides on PRN elevation.**

---

## File Structure

**Modified:**
- `src/modules/portal/queries.ts` — convert the module-level `LATEST_STATUS`/`STATUS_EXPR`/`STATUS_ORDER` consts into small scope-aware builders (`latestStatus(scope)` → `statusExpr(scope)` → `statusOrder(scope)`); `latestStatus` gains `and ${tenantWhere(schema.leadStatusHistory, scope)}`. Build them inside `listPartnerLeads` (where `scope` exists) and use at the sort-col + status-filter sites.
- `src/modules/leads/queries.ts` — same: `LATEST_STATUS`/`LATEST_AT`/`STATUS_EXPR`/`MODIFIED_EXPR`/`STATUS_ORDER` become scope-aware builders; `latestStatus(scope)` and `latestAt(scope)` each gain `and ${tenantWhere(schema.leadStatusHistory, scope)}`. Build inside `listLeads` and use at the sort/filter/select sites.
- `docs/ENGINEERING_STANDARDS.md` — add the rule (tenancy/data section).

**Not touched:** `src/lib/scope.ts`, schema/migrations, any route, the analytics module (its `lead_status_history` reads already go through `tenantWhere`/CTEs).

---

## Task 1: Self-scope the three correlated subqueries + document the rule

**Files:**
- Modify: `src/modules/portal/queries.ts`, `src/modules/leads/queries.ts`, `docs/ENGINEERING_STANDARDS.md`
- Test: extend `tests/integration/portal-leads-sort-filter.test.ts` and/or the admin leads test with a self-scope invariant guard (see Step 3).

**Interfaces:**
- Portal: `statusExpr(scope)` + `statusOrder(scope)` (module-local, returning `SQL`) replacing the const `STATUS_EXPR`/`STATUS_ORDER`; called once inside `listPartnerLeads`.
- Admin: `statusExpr(scope)`, `modifiedExpr(scope)`, `statusOrder(scope)` (returning `SQL`) replacing the const versions; called once inside `listLeads`.
- Each `latestStatus(scope)`/`latestAt(scope)` subquery = `sql\`(select … from lead_status_history where lead_id = ${schema.leads.id} and ${tenantWhere(schema.leadStatusHistory, scope)} order by created_at desc limit 1)\``.

- [ ] **Step 1: Confirm the `tenantWhere` interpolation shape** — read `src/lib/scope.ts` `tenantWhere` + the working precedent in `src/modules/analytics/partner-performance.ts` (`histTenant` interpolated into a raw `sql` subquery). Confirm `tenantWhere(schema.leadStatusHistory, scope)` emits a qualified `"lead_status_history"."tenant_id" = $n` condition that composes inside a `sql\`…\`` template with no alias clash (the outer query is on `leads`, the subquery on `lead_status_history`).
- [ ] **Step 2: Implement** the scope-aware builders in both files, threading `scope` in. Add a one-line comment on each subquery: "self-scoped (ADR-0013 defence-in-depth): the correlation key `leads.id` is globally unique, but we carry an explicit tenant predicate too so no single-predicate change can widen scope." Keep the `STATUS_ORDER` case ranks, the admin `mlsStatus='removed' → 'Removed MLS'` branch, and `MODIFIED_EXPR`'s `coalesce(..., manualAssignedAt)` EXACTLY as they are — only the inner subquery gains the tenant predicate.
- [ ] **Step 3: Add the regression + invariant tests.**
  - **Behavior-preserving (primary guard):** run the EXISTING suites — `tests/integration/portal-leads-sort-filter.test.ts` (`PW3-01..06`) and the admin leads list/sort/status/detail integration tests — and confirm all green (identical results). Add `F1-01`: a portal `sort=status` + `status=` filter case that asserts the SAME expected rows/counts as before (proves the added predicate didn't change results). Reuse the existing seed.
  - **Invariant (optional but recommended):** `F1-02` — build the query and assert the generated SQL carries the tenant scoping in the subquery, e.g. via drizzle `.toSQL()` on a representative query (or a `statusExpr(scope).toSQL?()`/`getSQL()` shape check) asserting the subquery text includes the `tenant_id` predicate. If a clean SQL-string assertion isn't practical, SKIP F1-02 and document in the report that the guard is the behavior-preserving suite + code review (do not add a brittle full-SQL snapshot).
- [ ] **Step 4: Document the rule** in `docs/ENGINEERING_STANDARDS.md` — a concise rule in the tenancy/data section: *"Correlated child subqueries in a WHERE/ORDER BY/SELECT expression must carry their own tenant scope (`tenantWhere(childTable, scope)`), not rely solely on a correlation key. Defence-in-depth per ADR-0013 (no RLS): a single dropped predicate must not be able to widen scope."* Note the three sites now conforming. Flag (in the doc or the summary) that the owner may elevate this to a numbered PRN.
- [ ] **Step 5: Green + suites + typecheck + lint** — the changed integration files + the FULL unit suite (`pnpm test:unit -- --no-file-parallelism`) + the portal-leads + admin-leads integration tests, then `pnpm typecheck`, then `npx eslint` on the changed `.ts` files (0/0). Confirm no behavior drift (counts/order unchanged).

---

## Verification (before the walkthrough)

- The behavior-preserving suites prove no result change; the invariant test (if added) proves the tenant predicate is present. Optionally, `EXPLAIN`/`.toSQL()` one query to eyeball the subquery now reads `… where lead_id = … and "lead_status_history"."tenant_id" = … order by created_at desc limit 1`.
- No UI change → no screenshots.

## Reviews (mandatory)

- `pr-reviewer` (always) + **`audit-tenancy`** (the whole point — confirm all three subqueries are now self-scoped via `tenantWhere`, the change is behavior-preserving, and the sweep found no fourth site) + `audit-architecture` (confirm the in-place approach didn't introduce an unwanted cross-module dependency, and the ENGINEERING_STANDARDS rule is coherent). Opus whole-branch review at the end. Owner walkthrough before committing.

## Self-audit + commit

- PLAYBOOK §6 self-audit printed in the summary. **Tier A** (scope-guarded query construction) → run the tenancy checklist. ONE `feat` commit (+ the `docs` plan commit) after owner "go"; push after a separate "go".

---

## Deliverable

After WP-F1: all three correlated `lead_status_history` subqueries (portal + admin leads lists) carry an explicit `tenantWhere` predicate — defence-in-depth per ADR-0013 — with the pattern codified in `docs/ENGINEERING_STANDARDS.md` so it can't silently recur. Behavior unchanged. **Deferred candidate:** a shared `latestStatusExpr(scope)` helper to DRY the (now three) near-identical self-scoped subqueries — deferred here to avoid a leads↔portal module dependency without an architecture decision. **This closes the queued portal-web line items (WP-PW-4, WP-PW-2b, F-1).**
