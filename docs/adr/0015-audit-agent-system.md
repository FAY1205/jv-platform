# ADR-0015: Dual-lens audit agent system (read-only, spec-anchored)

- **Status:** Draft (system built 2026-07-09; owner accepts by keeping it)
- **Date:** 2026-07-09
- **Phase / WP:** process

## Context

The platform is built solo with AI coding agents against a binding spec
(`docs/SPEC.md` requirement IDs) and a risk-tiered WP cadence. As the codebase grows,
two failure modes threaten it: drift from the spec (internal), and gaps the spec never
covered because no spec is complete (external — OWASP, WCAG, SOC 2, CWV). One-off
review prompts don't scale and produce inconsistent severity/format.

## Decision

Install a standing audit system:

- **16 read-only agents** in `.claude/agents/` (14 specialists + `pr-reviewer` +
  `audit-synthesizer`), each with restricted tools (Read/Grep/Glob; Bash only where an
  analyzer is needed) and a domain protocol. Agents propose fixes as diffs — they
  never edit. Model tiers: opus for tenancy/security/pipeline/architecture/synthesis;
  sonnet for the rest.
- **Dual lens everywhere:** every finding is tagged `SPEC-VIOLATION`, `EXTERNAL-GAP`
  (spec silent — includes a drafted spec amendment), or `SPEC-BELOW-BAR` (spec exists
  but under the industry bar — proposes an ADR, never silently exceeds spec).
- **Uniform contract:** `docs/audit/PROTOCOL.md` (severity, format, caps, honesty
  rules). Reports land in `docs/audit/` (dated, committed); per-agent raw output in
  `docs/audit/raw/` (git-ignored scratch).
- **Orchestration:** the `/audit` skill (Claude Code subagents cannot spawn subagents,
  so selection/dispatch runs in the main session) routes scopes to specialists and
  has `audit-synthesizer` merge, dedupe, and produce the executive report + remediation
  roadmap bucketed now / next-WP / phase-gate / Phase-5.
- **Standards docs** (`docs/ENGINEERING_STANDARDS.md`, `docs/FRONTEND_STANDARDS.md`)
  canonicalize existing patterns; agents read them first so audits converge.
- **New devDependency:** `@axe-core/playwright` (+`axe-core`) for WCAG scans via
  `scripts/audit-axe.ts` against a served build (`pnpm audit:serve`). Dev-only, no
  runtime surface. Recorded here per the no-new-deps-without-ADR rule.

Alternatives considered: single "reviewer" mega-agent (inconsistent depth, no
domain protocols); CI-only linting (catches syntax-level issues, not invariants like
PRN-05/ASN-02); external audit tooling (nothing understands the spec's requirement IDs).

## Consequences

- Findings become WP candidates through the existing backlog — audits never smuggle
  scope (CLAUDE.md working rules hold).
- Spec amendments surface as drafted requirement IDs for the owner to accept into
  SPEC.md via ADR — the spec stays the contract AND keeps up with the industry bar.
- Cost: a `/audit full` dispatches up to 14 specialist runs (5 on opus). Path-routed
  `/audit diff` keeps day-to-day cost small.
- Maintenance duty: when SPEC.md or the standards docs change, the affected agents'
  directives must be updated in the same change (the synthesizer flags stale refs).
