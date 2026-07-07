# ADR-0002: Component testing stack

- **Status:** Accepted
- **Date:** 2026-07-07
- **Phase / WP:** Phase 0 / WP-004

## Context

Spec §13 names "Playwright + Vitest" for testing but not a React component testing
library. DSN-03 requires every interactive component to implement its full state
set; those states should be asserted in unit tests, which needs a DOM environment
and a rendering/query API.

## Decision

Adopt the conventional Vitest companions:
- **jsdom** — DOM environment for component tests (opted in per-file via a
  `@vitest-environment jsdom` docblock; the default test environment stays `node`
  so pure-module tests keep running fast).
- **@testing-library/react** + **@testing-library/user-event** — render + interact.
- **@testing-library/jest-dom** — DOM matchers, registered in `tests/setup.ts`.

These are standard, boring, and widely used with Vitest. Playwright remains the
tool for end-to-end flows (TST-07); Testing Library covers component-level state.

## Consequences

- Component tests live in `tests/unit/components/*.test.tsx` with the jsdom docblock.
- No change to how pipeline/security tests run (still node env).
- Four dev dependencies added, recorded here per the "no new deps without an ADR" rule.
