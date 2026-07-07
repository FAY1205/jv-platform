# ADR-0003: Supabase regions & data residency (EU dev / US prod)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Phase / WP:** Phase 0 / WP-005

## Context

Spec LGL-03 / SCP-03 require all providers pinned to **US regions** for data
residency. The owner runs the **development/testing** Supabase project in
**Central EU (Frankfurt)** and will run **production** in the **US**. On its face
this deviates from LGL-03, so it is recorded here.

## Decision

- **Dev/preview** Supabase project: **EU (Frankfurt)**. Permitted because
  non-production holds **synthetic/fake data only** (SEC-07) — no real seller or
  partner PII ever lives there. The email sink (WP-002) already guarantees no
  real partner can be contacted from non-prod.
- **Production** Supabase project: **US region** (LGL-03), separate project and
  credentials (SEC-07). Real consumer PII lives only here.

## Consequences

- LGL-03's residency guarantee is upheld **for production data**, which is what
  the rule protects. The EU dev project is a fake-data sandbox.
- **Hard guardrail:** real PII must never flow to the EU dev/preview project. The
  environment-separation code (SEC-07) and the fake-data-only seed enforce this.
- The published subprocessor list (LGL-02) and privacy page must describe
  production residency accurately (US) and note the non-prod sandbox region.
- If a future customer contract forbids any EU processing even of test data, the
  dev project moves to a US region — a project swap, no code change.
