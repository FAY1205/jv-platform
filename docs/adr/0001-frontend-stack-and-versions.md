# ADR-0001: Frontend framework versions and styling layer

- **Status:** Accepted
- **Date:** 2026-07-07
- **Phase / WP:** Phase 0 / WP-001

## Context

Spec §13 locks the stack but names it at the ecosystem level ("Next.js App Router on
Vercel", "Playwright + Vitest") without pinning majors, and does **not** name a CSS
framework. The demo (`docs/design-reference/demo-v1.html`) is hand-written CSS driven by
CSS custom properties (design tokens) — no Tailwind. WP-001 must pick concrete versions and
a styling approach to scaffold against.

## Decision

- **Next.js 16.2.10 · React 19.2.4 · TypeScript 5** — the current `create-next-app` baseline;
  App Router + `src/` dir + `@/*` alias, matching Playbook §2.
- **Tailwind CSS v4** as the styling layer, configured **CSS-first** (`@import "tailwindcss"`
  + `@theme`). It consumes the semantic design tokens defined in `src/lib/tokens` (WP-003);
  Tailwind is the utility/consumption layer, **not** the source of truth for design values.
  This preserves PRN-12 (components read semantic tokens, never hardcoded hex) and SEAM-08
  (one token source feeds Tailwind theme, email templates, and export legend styling).
- **Vitest 3** (unit/integration) + **Playwright 1.61** (e2e) per §13.
- Build-script policy for `esbuild`, `sharp`, `unrs-resolver` is allowlisted in
  `pnpm-workspace.yaml` (`allowBuilds`), pnpm 11's required location.

## Consequences

- Tailwind v4's CSS-first `@theme` maps cleanly onto the demo's CSS-variable token model, so
  migrating the demo's look into a real component library (WP-003/004) is low-friction.
- No CSS-in-JS runtime; theming (incl. future per-tenant white-label) stays a token swap.
- Version majors (Next 16 / React 19 / Tailwind 4) are recent; if a dependency in the locked
  stack (e.g. a chart or map lib) lags on React 19 support, that surfaces at its WP and gets
  its own ADR.
- Tailwind is a dependency **not** enumerated in §13; this ADR is its record of adoption.
