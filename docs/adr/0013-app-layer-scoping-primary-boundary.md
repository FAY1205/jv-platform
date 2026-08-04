# ADR-0013: App-layer scoping is the primary tenant boundary; RLS is the backstop

- **Status:** Draft (canonicalizes an existing implicit decision — owner to confirm)
- **Date:** 2026-07-09
- **Phase / WP:** process (discovered during the audit-system build)

## Context

SEC-01/PRN-08 require tenant isolation enforced in application code AND Postgres RLS.
All 22 tables have RLS enabled with deny-by-default policies (migration 0001 onward),
and every request-path query builds its WHERE via `src/lib/scope.ts` (TST-01 proves
isolation live).

However, the app connects through the Supabase session pooler as `postgres.<ref>` —
the table **owner**. PostgreSQL does not apply RLS to table owners unless
`FORCE ROW LEVEL SECURITY` is set, and no migration sets it. Policies are written for
the Supabase API surface (anon/authenticated roles), which the app does not use for
data access. So in practice:

- **App queries (Drizzle):** constrained ONLY by the `scope.ts` builders.
- **RLS:** constrains the PostgREST/anon surface and any non-app credential — a real
  backstop against leaked anon keys or future API-surface use, but not against a
  missed `WHERE` in app code.

This was never written down; code comments in `scope.ts` imply RLS is a second active
layer for app queries, which overstates it.

## Decision

- Recognize the **scope builders as the primary and only live boundary for app
  queries**. A query path that bypasses them is a **Critical** defect regardless of
  whether it "looks" tenant-filtered.
- Keep RLS deny-by-default on every table (unchanged) as the backstop layer.
- Enforcement mechanism: the `audit-tenancy` agent reviews every diff touching
  query paths; TST-01-style isolation tests accompany every new query path.
- **Do not adopt `FORCE ROW LEVEL SECURITY` now.** With the current owner connection,
  FORCE RLS would deny the app itself unless we also move to a non-owner app role with
  session-GUC tenant pinning (`SET app.tenant_id = …`) and rewrite policies against
  it — a meaningful redesign with pooler implications (GUCs + transaction pooling).

Alternatives considered:
- FORCE RLS + non-owner role + GUC-keyed policies now — strongest isolation, but a
  cross-cutting change mid-Phase-2 with real pooler complexity; deferred, not rejected.
- Trusting RLS alone (dropping app-layer builders) — impossible: policies don't apply
  to the app connection at all.

## Consequences

- Every future query-path review treats `scope.ts` as load-bearing; reviewer and
  audit tooling assume NO database backstop for app queries.
- **Revisit trigger:** before Phase 5 (first external tenant), re-evaluate the
  non-owner-role + FORCE RLS design as defense-in-depth; record the outcome as a new
  ADR. Until then, this ADR documents the accepted risk.
- `docs/ENGINEERING_STANDARDS.md` §2 carries the operational rules.
