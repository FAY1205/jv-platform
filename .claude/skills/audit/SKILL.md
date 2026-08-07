---
name: audit
description: Orchestrate the JV Platform audit system — select specialist audit agents by scope, dispatch them in parallel, synthesize an executive report. Use when the user asks for an audit, a review sweep, or /audit with a scope (diff | <area> | full | gate).
---

# /audit — orchestrated codebase audit

You (the main session) are the orchestrator: subagents cannot spawn subagents, so YOU
select, dispatch, collect, and have `audit-synthesizer` merge. All agents are
read-only; you write the report files.

## 1. Resolve scope from the argument

- **(no arg) or `diff`** — audit uncommitted + unmerged work: collect changed files via
  `git diff --name-only main...HEAD` plus `git status --porcelain`. Route by path (below).
- **`full`** — all 16 specialists over the whole repo.
- **`gate`** — same as `full`, but tell each agent this is a pre-phase-gate audit
  (they escalate standing items that block a §11 gate) and pass the gate name.
- **`<area>`** — one of:
  `auth|security` → audit-security, audit-tenancy · `pipeline` → audit-pipeline,
  audit-data · `data|db` → audit-data, audit-tenancy · `api` → audit-api-contract,
  audit-tenancy · `frontend` → audit-frontend-arch, audit-design-system,
  audit-ux-flows, audit-a11y, audit-frontend-perf · `ux` → audit-ux-flows, audit-a11y ·
  `tests` → audit-tests · `devops|ci` → audit-devops · `compliance` → audit-compliance ·
  `arch` → audit-architecture · `ai` → audit-ai-surface, audit-security ·
  `hygiene` → audit-hygiene.
- A file/directory path as the arg → route that path like a diff.

## 2. Path → agent routing table (diff mode)

| Changed path | Dispatch |
| --- | --- |
| `src/lib/auth/**`, `src/proxy.ts`, `src/lib/supabase/**`, `src/app/api/auth/**` | audit-security (+ audit-tenancy if queries touched) |
| `src/app/api/**` | audit-tenancy, audit-api-contract |
| `src/lib/scope*.ts` | audit-tenancy |
| `src/db/**` (schema/migrations/seed) | audit-data, audit-tenancy |
| `src/modules/pipeline|sources|rules|run/**` | audit-pipeline |
| `src/modules/export/**`, `src/modules/notify/digests.ts` | audit-api-contract, audit-security |
| `src/components/**`, `src/app/**/*.tsx`, `src/lib/tokens/**` | audit-design-system, audit-frontend-arch |
| `src/workers/**`, heavy-dep changes | audit-frontend-perf |
| `tests/**` | audit-tests |
| `.github/**`, `package.json`, root configs | audit-devops |
| `docs/SPEC.md`, `docs/adr/**` | audit-architecture |
| `src/modules/ai/**`, `src/app/api/ai/**`, assistant widget/settings | audit-ai-surface, audit-security |

`pr-reviewer` always runs first in diff mode. Dedupe the resulting agent set; skip
agents whose routed file set is empty and record the skip.

## 3. Dispatch

- Create the run directory: `docs/audit/raw/<YYYY-MM-DD>-<scope>/`.
- Record run metadata: date, scope, `git rev-parse --short HEAD`, agent list.
- Dispatch all selected agents **in parallel** (one message, multiple Agent calls).
  Each dispatch prompt must include: the scope (exact file list for diff mode, or
  "full sweep"), the run's git SHA, and "follow docs/audit/PROTOCOL.md".
- As each agent returns, write its raw output verbatim to
  `docs/audit/raw/<run>/<agent-name>.md`.
- Cost note: `full`/`gate` dispatches up to 16 agents (6 on opus) — confirm with the
  user before dispatching more than 8 agents unless they asked for full/gate explicitly.
- `audit-hygiene` runs in every `full`/`gate` sweep and at Tier B checkpoints; in
  diff mode dispatch it only when the diff spans ≥3 modules (decay is cross-cutting).

## 4. Synthesize

- Dispatch `audit-synthesizer` with: the run metadata + the list of raw file paths.
- Write its report to `docs/audit/<YYYY-MM-DD>-<scope>.md` (committed; raw/ is git-ignored).
- If only ONE specialist ran (narrow diff), skip the synthesizer and write that
  agent's report directly to `docs/audit/<YYYY-MM-DD>-<scope>.md` with the run header.

## 5. Present

Reply with: the executive summary verbatim, the top-risk table, the roadmap buckets,
and the report path. Offer — do not start — the "Now" bucket fixes; remediations
beyond that become WP candidates for the owner's backlog (CLAUDE.md working rules).

## Environment notes for dispatches

- `audit-a11y` and `audit-frontend-perf` do their best work against a served build:
  `pnpm audit:serve` (build + start on :4500), then axe via `pnpm audit:axe` with
  `AUDIT_ADMIN_EMAIL`/`AUDIT_ADMIN_PASSWORD` set (dev admin). Tell them whether a
  server is up; they degrade to static analysis and say so if not.
- `audit-data` and `audit-tests` can use the live dev DB only when `.env.local`
  provides `DATABASE_URL`; integration suites there run `--no-file-parallelism`.
