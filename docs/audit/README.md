# The audit system — how to use it

A standing system of 18 read-only Claude Code agents that audit this codebase against
BOTH its own contract (`docs/SPEC.md` requirement IDs, ADRs, standards docs) AND
industry practice (OWASP ASVS/API Top 10, OWASP LLM Top 10, WCAG 2.1 AA, Core Web
Vitals, SOC 2, OpenSSF), plus the documented failure patterns of AI-assisted
codebases ([VIBE-CODE-FAILURE-CATALOG.md](VIBE-CODE-FAILURE-CATALOG.md)). Decision
record: `docs/adr/0015-audit-agent-system.md` (incl. 2026-08-05 amendment). Uniform
output contract: [PROTOCOL.md](PROTOCOL.md).

**Agents never edit code.** They produce findings with `file:line` evidence, severity
(Critical/High/Medium/Low), a dual-lens verdict (`SPEC-VIOLATION` / `EXTERNAL-GAP` /
`SPEC-BELOW-BAR`), and concrete remediation diffs. Fixes beyond trivial become WP
candidates — the audit system feeds the backlog, it does not smuggle scope.

## Quick start

| You want | Do this |
| --- | --- |
| Review current work before committing | Ask for the **pr-reviewer** agent (or just "review my diff") |
| Audit the changed files with the right specialists | `/audit` (or `/audit diff`) |
| Audit one domain | `/audit auth` · `/audit pipeline` · `/audit frontend` · `/audit data` · `/audit api` · `/audit tests` · `/audit devops` · `/audit compliance` · `/audit arch` · `/audit ux` · `/audit ai` · `/audit hygiene` |
| Full sweep + executive report | `/audit full` |
| Pre-phase-gate audit (e.g. before WP-035) | `/audit gate` |
| One specialist directly | "Run audit-tenancy on src/app/api/portal" (any agent by name) |

Reports land in `docs/audit/YYYY-MM-DD-<scope>.md` (committed). Per-agent raw output
goes to `docs/audit/raw/` (git-ignored scratch).

## The roster

| Agent | Domain | Model |
| --- | --- | --- |
| `pr-reviewer` | Daily-driver diff review: correctness, tier classification, self-audit checklist | sonnet |
| `audit-tenancy` | Tenant/partner isolation (scope.ts is the only live boundary — ADR-0013) | opus |
| `audit-security` | AuthN/Z, CSRF, injection, headers, client-boundary security (ASVS) | opus |
| `audit-pipeline` | Determinism: purity, MLS corpus, immutability, snapshots, golden | opus |
| `audit-architecture` | Module boundaries, ADR conformance, seams, scope creep | opus |
| `audit-api-contract` | Zod/envelope/status uniformity, breaking changes, export + digest contracts | sonnet |
| `audit-data` | Migration safety, indexes, transactions, N+1, lifecycle/growth | sonnet |
| `audit-tests` | TST-01..12 matrix, assertion quality, self-skip hygiene, pyramid | sonnet |
| `audit-devops` | CI gates, supply chain, SEC-07 separation, deploy/observability readiness | sonnet |
| `audit-compliance` | SOC 2 evidence, PII boundaries, retention, residency, legal gates | sonnet |
| `audit-frontend-arch` | TanStack Query discipline, client/server boundary, type safety | sonnet |
| `audit-ux-flows` | Loading/empty/error/success matrix, forms, critical flows, responsive | sonnet |
| `audit-a11y` | WCAG 2.1 AA by success criterion; axe runs against a served build | sonnet |
| `audit-design-system` | PRN-12 tokens, component states, gallery currency, theme parity | sonnet |
| `audit-frontend-perf` | Bundles, virtualization (FEP-03), re-renders, CWV readiness | sonnet |
| `audit-ai-surface` | The app's own GenAI feature vs OWASP LLM Top 10: prompt injection, tool agency, BYO-key handling, output handling, consumption | opus |
| `audit-hygiene` | AI-code decay: duplication, dead code, swallowed errors, stubs, idiom divergence, doc drift (jscpd/knip/depcheck) | sonnet |
| `audit-synthesizer` | Merges raw findings → executive report + remediation roadmap | opus |

## When each runs (recommended cadence)

Bound to the owner's risk-tier cadence, not calendar weeks:

- **Every WP, before commit:** `pr-reviewer`, plus path-routed Tier A specialists
  (the routing table lives in `.claude/skills/audit/SKILL.md` §2). Cheap, focused.
- **Tier B batch checkpoint (~2–3 WPs):** `audit-architecture`, `audit-tests`,
  `audit-ux-flows`, `audit-frontend-perf`, `audit-devops`, `audit-hygiene`.
- **Pre-phase-gate (§11):** `/audit gate` — everything + synthesis. WP-035 is the
  first customer.
- **Milestones / before real partners / before first deploy:** `audit-compliance`;
  `audit-devops` is mandatory pre-deploy.

## Live-app audits (a11y / perf)

```bash
pnpm audit:serve        # next build && next start on http://localhost:4500
# in another shell (uses the dev admin; NEVER a real credential):
$env:AUDIT_ADMIN_EMAIL="dev-admin@dev-jv.test"; $env:AUDIT_ADMIN_PASSWORD="<dev pw>"; pnpm audit:axe
```

`scripts/audit-axe.ts` signs in via the login form, scans key admin pages + public
auth pages with axe-core (WCAG 2.1 A/AA tags), prints a summary, and writes JSON to
`docs/audit/raw/`. Without credentials it scans public pages only and says so.
Needs `.env.local` (DB + Supabase) because the served app is the real app.

## Optional CI wiring (documented, deliberately not enabled)

A PR-level audit can run headless once the repo has an `ANTHROPIC_API_KEY` secret —
enable only when you want the spend:

```yaml
# .github/workflows/audit.yml (create when ready)
name: audit
on: { pull_request: { branches: [main] } }
jobs:
  pr-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: npm install -g @anthropic-ai/claude-code
      - run: claude -p "/audit diff" --allowedTools "Read,Grep,Glob,Bash(git *),Agent" --output-format text
        env: { ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }} }
```

A cheaper standing alternative: keep audits interactive (the cadence table above) and
let CI run only the deterministic gates it already has.

## Interpreting reports

- **`SPEC-VIOLATION`** — code broke your contract. Fix toward the cited requirement ID.
- **`EXTERNAL-GAP`** — your spec never covered it; industry expects it. The finding
  includes a drafted requirement ID — accepting it into SPEC.md (via ADR) is an owner
  decision; the code fix can proceed independently when harmless.
- **`SPEC-BELOW-BAR`** — the spec has a rule but it's under the industry bar. Never
  silently exceeded: the report proposes an ADR and waits for the owner.
- **Owner reality-gate items** (ToS docs, DNS, real coverage) are listed separately
  from code work — they gate real-world operation, not development.

## Maintenance duties

- SPEC.md or standards-doc changes ⇒ update the affected agents' directives in the
  same change (the synthesizer flags stale references it detects).
- New standing risk discovered ⇒ add it to the relevant agent as a "standing item"
  so it stays visible until resolved (current examples: FORCE-RLS revisit, TST-07,
  security headers, FEP-03 virtualization, retention sweep).
- Roster changes are ADR-0015 amendments.
