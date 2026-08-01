# WP-SU-21: self-serve tenants get ingestion config + a signup link (SCP-02)
Spec: SCP-02 (self-serve provisioning) · PRN-15 (single source) · Phase: 2 · Tier: A · Depends: WP-LS1 (Lead Source 1 profile/transform), signup provisioning

## Problem (verified 2026-08-01 against a live self-serve tenant)
`provisionSignup` creates only the tenant, admin user, audit-log row, and ToS acceptance
([provision-signup.ts:111-123](src/lib/auth/provision-signup.ts)). It does **not** seed the
ingestion rules-as-data. And `db/seed.ts` — which seeds the `lead-source-1` profile + MLS v2
patterns + settings — is hardcoded to the **`dev-jv`** dev tenant. So:

> Every self-serve tenant is created with **no source profile, no MLS patterns, no settings** — it
> cannot import leads. Uploads fall to the manual "map a template" screen (no profile ≥50% overlap
> to match). Verified live: the first real signup tenant had `source_profiles=0 mls_patterns=0`.

This is not a format problem (the 179-col Lead Source 1 export is supported); it's a missing-seed
gap that blocks every self-serve tenant from the core workflow.

## Design
### B — seed ingestion rules on signup
- Extract `seedTenantRules(db, tenantId)` into `src/db/seed-tenant-rules.ts` (pure, no self-exec —
  so it's importable by both the dev seed and `provisionSignup`; `db/seed.ts` self-executes `main()`
  on import and must not be imported by app code).
- It seeds the **partner-independent** config: the Lead Source 1 source profile (WITH its
  `transform`, so skip-trace strip + address/ZIP derivation run — WP-LS1), MLS v2 patterns, and
  Setting/Feature-flag defaults. Accepts a DB **or** a transaction (drizzle's tx satisfies `DB`).
- `provisionSignup` calls it **inside** the provisioning transaction, right after the tenant insert
  — a tenant is never created without its ingestion config; a failure rolls back the whole signup
  (the existing compensating saga deletes the auth user).
- `db/seed.ts` now calls `seedTenantRules` too (single source, PRN-15) — a dev tenant and a
  signed-up tenant start byte-identically. Partners + state_rules stay in the dev seed (they're
  partner-dependent; `state_rules` FK partners, and a brand-new tenant has none).
- **Deliberately NOT seeded:** partners, coverage_zips, state_rules — tenant-specific admin setup.
  A fresh tenant's leads start Unmatched until the admin adds partners + coverage (correct, not a bug).
- **DM-08:** no rules-snapshot needed — snapshots are captured at run time (`process.ts`), and this
  is a tenant's *initial* seed, not a mutation of existing rules.

### C — "Sign up" link on the login page
- Split `login/page.tsx` (was entirely `"use client"`) into a **server page** that reads
  `isSignupEnabled` (server-only env) + a client `login-form.tsx`. The server passes the flag as a
  prop, so the link shows only when public signup is enabled (the compliance kill-switch) without
  leaking a `NEXT_PUBLIC_*` mirror into the client bundle.

## Definition of done
- [x] `seedTenantRules` seeds source profile (w/ transform) + MLS patterns + settings + flags;
      not partners/coverage/state_rules. (`tests/integration/seed-tenant-rules.test.ts`, 2/2)
- [x] `provisionSignup` seeds the config in-transaction (asserted in `provision-signup.test.ts`
      happy path — not run against prod, see risks).
- [x] `db/seed.ts` refactored to the shared seeder (PRN-15) — dev seed unchanged in effect.
- [x] Login page shows/hides the Sign up link on `isSignupEnabled` (`tests/unit/login-page.test.tsx`, 3/3).
- [x] Typecheck + lint clean.
- [x] Reviews: pr-reviewer + audit-security + audit-data — all GO, no blockers. audit-data F-1 folded
      (added a rollback-only tx test proving the provisionSignup insert sequence works with a tx
      handle + rolls back cleanly, no prod pollution); log wording fixed. Deferred candidates:
      dev-seed atomicity (pre-existing), /signup page 404 when disabled (pre-existing).
- [ ] Owner walkthrough. No commit/push until owner go.

## Notes / risks
- **Test-DB pollution (flag):** Frankfurt is now BOTH the dev/test DB and production. Integration
  tests that create tenants (provision-signup, etc.) leave undeleteable rows (audit_log FK) in
  production. `seed-tenant-rules.test.ts` is fully self-cleaning (bare tenant, no audit_log); the
  provision-signup wiring assertion was NOT run against prod. **Follow-up: a separate test/dev
  Supabase project (SEC-07's original intent).**
- One-off already applied: `faisal-test` tenant was seeded manually so the owner can import today.
- Land on `claude/wp-tenant-seed` → merge to `main` (auto-deploys).
