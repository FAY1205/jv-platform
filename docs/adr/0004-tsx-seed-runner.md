# ADR-0004: tsx as the TypeScript script runner

- **Status:** Accepted
- **Date:** 2026-07-07
- **Phase / WP:** Phase 0 / WP-005

## Context

The database seed (`src/db/seed.ts`) is authored in TypeScript so it can import
its data from the same modules the app uses (MLS patterns, source profile, partner
palette) — single source, no duplication (PRN-15). Running a standalone `.ts`
script needs a runner. Spec §13 does not name one.

## Decision

Use **tsx** (dev dependency) to run TS scripts (`pnpm db:seed`). It is a standard,
widely used esbuild-based runner. Seed scripts use **relative imports** (not the
`@/` alias) to avoid tsconfig-path resolution concerns under tsx.

## Consequences

- One dev dependency added, recorded here per the "no new deps without an ADR" rule.
- Seeds stay single-source (import real module data) instead of duplicated as SQL.
- Migrations (schema + RLS) remain SQL applied via `drizzle-kit`; only data seeding
  uses tsx.
