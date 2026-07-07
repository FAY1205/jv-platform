# ADR-0005: zxcvbn for password strength

- **Status:** Accepted
- **Date:** 2026-07-07
- **Phase / WP:** Phase 0 / WP-007

## Context

Spec AUT-02 requires admin password strength to be checked with **zxcvbn score ≥ 3**
(plus min length 12 and a breach check). zxcvbn is named explicitly in the spec.

## Decision

Add **zxcvbn** (classic, with `@types/zxcvbn`) as the strength estimator. The
breach check uses the HaveIBeenPwned **k-anonymity range API** (SHA-1 prefix), built
over an injectable fetcher so it is testable offline and network-optional.

## Consequences

- One runtime dependency (zxcvbn ~400 KB) — loaded server-side only (password checks
  happen in API routes), so it does not affect client bundle budgets (FEP-07).
- Recorded here per the "no new deps without an ADR" rule; zxcvbn is spec-mandated.
