# JV Platform (working name: TerritoryDesk)

A deterministic lead-routing platform for real-estate JV networks. Weekly seller-lead
files are uploaded → parsed → normalized → MLS-filtered → assigned by territory
(ZIP-first, state fallback) → deduped against permanent history → recoded → distributed
via colored Excel, partner portal, and email.

**The spec is the contract.** See [`docs/SPEC.md`](docs/SPEC.md) (the numbered requirements)
and [`docs/PLAYBOOK.md`](docs/PLAYBOOK.md) (how we build it). Binding rules for every coding
session live in [`CLAUDE.md`](CLAUDE.md). The current execution roadmap and Phase 0 work
packages are tracked in the backlog.

## Stack (locked — spec §13)

TypeScript · Next.js (App Router) on Vercel · Supabase US (Postgres + Auth + Storage + RLS) ·
Drizzle ORM · Zod · TanStack Query · exceljs (write) + SheetJS (read, Web Worker) · Resend ·
Recharts + D3/TopoJSON · Playwright + Vitest · Sentry · GitHub Actions.

## Prerequisites

- **Node** ≥ 22 and **pnpm** ≥ 11 (both detected in this environment)
- **git** (repo initialized)
- **Docker Desktop** + **Supabase CLI** — required for the local Postgres/RLS work
  (WP-005+). Not yet installed; see "Local setup" below.

## Getting started (local-first)

```bash
pnpm install          # install dependencies
pnpm dev              # run the app at http://localhost:3000
pnpm check            # typecheck + lint + unit/integration tests (the pre-merge gate)
pnpm e2e              # Playwright end-to-end tests (needs `pnpm exec playwright install`)
```

Copy `.env.example` to `.env.local` and fill values as each phase needs them. Non-production
environments must use separate Supabase projects and an email sink (SEC-07) — never real
partner email from dev/preview.

## Local setup still needed (owner checklist)

1. Install **Docker Desktop** (for the Supabase local stack).
2. Install the **Supabase CLI**: `pnpm add -g supabase` (or scoop/winget), then `supabase init` + `supabase start`.
3. Create cloud accounts just-in-time: Supabase (US region), Vercel, Resend — before the phases that need them.
4. Provide 2+ real sample lead files per source + one hand-verified week → becomes the TST-05 golden fixture.

## Repository layout

See [`docs/PLAYBOOK.md`](docs/PLAYBOOK.md) §2. In brief: `src/app` (routes), `src/components`
(the one component library), `src/modules/*` (pipeline, export, analytics, …), `src/lib`
(tokens, scope guard, auth), `src/db` (Drizzle schema + RLS + seeds), `tests/*`.
