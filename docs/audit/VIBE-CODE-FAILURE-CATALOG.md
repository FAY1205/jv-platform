# Vibe-code failure catalogue — documented failure patterns of AI-assisted codebases

Reference for the audit agents (ADR-0015 system). Compiled 2026-08-05 from incident
write-ups, security research, and empirical studies of AI-generated code (2024–2026).
Each pattern: what it is → evidence → the concrete check an auditor runs here.
Agents cite entries as `VCF-<n.n>`.

## Base rates (severity calibration)

- 98% of 1,072 scanned vibe-coded apps had ≥1 security flaw; 172 allowed
  unauthenticated DELETE of DB records — [Symbiotic Security](https://www.symbioticsec.ai/blog/we-scanned-1-072-vibe-coded-apps-98-had-security-flaws).
- 45% of LLM-generated code fails OWASP Top 10 checks — Veracode 2025 GenAI report
  ([summary](https://www.helpnetsecurity.com/2025/08/07/create-ai-code-security-risks/)).
- ~40% of Copilot-generated programs vulnerable across MITRE Top-25 scenarios —
  [Pearce et al., IEEE S&P](https://arxiv.org/abs/2108.09293).
- Developers using AI assistants wrote LESS secure code and rated it MORE secure —
  [Perry et al., CCS '23](https://arxiv.org/abs/2211.03622). "The prompter reviewed it"
  is weak assurance; that is why this audit system exists.
- 15 production AI-built apps, 5 major tools: 69 vulns; 15/15 lacked CSRF protection
  and security headers — Tenzai ([via](https://vibecoding.app/blog/vibe-code-audit)).

## VCF-1 — Security failure modes

| # | Pattern | Incident anchor | Check (owner agent) |
| --- | --- | --- | --- |
| 1.1 | Missing/permissive RLS while anon key ships in the client | CVE-2025-48757: 170+ Lovable apps, 303 endpoints exposed ([analysis](https://vibeappscanner.com/is-lovable-safe)) | Per-table `pg_policies` coverage probe + `USING (true)` grep; Supabase advisors (audit-data) |
| 1.2 | Second unaudited data path: client-side Supabase queries / service key client-side | Moltbook leaked 1.5M API keys in client JS ([kodu](https://blog.kodu.cloud/vibe-coded-apps-leaked-api-keys/)) | Client-boundary import grep + built-bundle secret grep over `.next/static` (audit-security) |
| 1.3 | Secrets committed / .env in history | CWE-259/798 top LLM-codegen CWE ([CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-generated-code-security-vibe-coding-202/)) | History scan for key prefixes + `.env*` add events (audit-devops) |
| 1.4 | Auth only on client; unprotected API routes/server actions | Tea app breach #2: 1.1M private DMs ([coverage](https://captaincompliance.com/education/tea-apps-second-breach-1-1-million-private-messages-exposed-in-a-devastating-privacy-failure/)) | Every route handler calls scope/guard before DB access (audit-tenancy, audit-security) |
| 1.5 | IDOR: `WHERE id = params.id` without tenant predicate | #1 category in vibe-app scans ([Strobes](https://strobes.co/blog/vibe-coded-app-vulnerabilities/)) | Any query outside `lib/scope.ts` is suspect — PRN-08 (audit-tenancy) |
| 1.6 | Open/legacy storage buckets | Tea breach #1: 72k images, 13k gov IDs in forgotten Firebase bucket ([security.org](https://www.security.org/identity-theft/breach/tea-app/)) | Bucket inventory: private + storage RLS + no orphans (audit-data, audit-security) |
| 1.7 | Wildcard CORS on authenticated routes | Tenzai 15/15 ([via](https://vibedoctor.io/blog/sec-004-cors-misconfiguration-vibe-coded-apps)) | Grep `Access-Control-Allow-Origin`/`origin: '*'` in routes/middleware/configs (audit-security) |
| 1.8 | No rate limiting on auth/expensive endpoints | leaked-key billing incidents $5k–50k ([cybersecify](https://cybersecify.com/blog/ai-api-key-leaks-vibe-coded-saas-pentest/)) | Throttle-kind wiring per auth-adjacent route — AUT-03/04 (audit-security) |
| 1.9 | SQLi/XSS/log-injection re-emergence despite ORM | Veracode: 86% failed XSS, 88% log injection | `sql.raw`/interpolated `sql\``/`dangerouslySetInnerHTML`/raw-input logging greps (audit-security) |
| 1.10 | Hallucinated packages / slopsquatting | 5–21% of LLM-recommended packages don't exist; 205k unique names ([USENIX '25](https://arxiv.org/pdf/2501.19012)) | Lockfile-diff: each new dep exists on npm, >90 days old, sane downloads, has ADR (audit-devops) |
| 1.11 | Missing CSRF + security headers | Tenzai 15/15 | `assertCsrf` reconciliation + headers config (audit-security, standing item) |
| 1.12 | Unverified webhooks / timing-unsafe compares | [vibe-check](https://github.com/benavlabs/vibe-check) | Signature-verify-before-parse + `timingSafeEqual` grep (audit-security) |

## VCF-2 — Code-quality decay (the GitClear signature)

| # | Pattern | Evidence | Check (owner agent) |
| --- | --- | --- | --- |
| 2.1 | Copy-paste duplication instead of reuse (~8x rise 2020→2024; clones = 15–50% more defects) | [GitClear 211M-line study](https://www.gitclear.com/ai_assistant_code_quality_2025_research) | jscpd sweep + same-name/same-signature helper grep (audit-hygiene) |
| 2.2 | Churn: code revised <2 weeks after landing (3.1%→5.7%) | GitClear | `git log` fix-commit heat per file (audit-hygiene) |
| 2.3 | Dead code accumulation; refactor collapse (moved lines 25%→<10%) | GitClear | knip/ts-prune/depcheck: unused exports, files, deps (audit-hygiene) |
| 2.4 | Comment/doc drift ("context rot") | [coderide](https://coderide.ai/blog/solving-context-loss-in-ai-code-assistants/) | Doc'd paths/symbols resolve; agent baseline facts vs reality (audit-hygiene) |
| 2.5 | Cross-session idiom divergence (competing envelopes, dup Zod schemas, re-declared constants) | [pharaoh](https://pharaoh.so/blog/prevent-duplicate-functions-ai-coding/) | Competing-idiom greps; envelope key-set diff vs `{code,message,traceId}` (audit-hygiene) |
| 2.6 | Silent fallbacks / swallowed errors / mock data as real (mechanism behind Replit's 4,000 fabricated users) | [augmentcode](https://www.augmentcode.com/guides/debugging-ai-generated-code-8-failure-patterns-and-fixes) | Empty/`return null`/`?? []` catch greps; hardcoded data in components (PRN-15) (audit-hygiene) |
| 2.7 | Assertion-poor tests; mocking the unit under test (Assertion Roulette >90% in 20,505 LLM suites) | [arXiv 2410.10628](https://arxiv.org/abs/2410.10628) | Zero-`expect` tests; `vi.mock` of subject; snapshot-only suites (audit-tests) |
| 2.8 | Tests gamed to pass — reward hacking (agents hardcode expected outputs, edit tests, print PASS) | [cheating-agents study](https://debugml.github.io/cheating-agents/), [ImpossibleBench](https://www.lesswrong.com/posts/qJYMbrabcQqCZ7iqm/impossiblebench-measuring-reward-hacking-in-llm-coding-1) | History diff for removed `expect`; fixture-shaped special cases in src; test+impl same-diff gate (audit-tests) |
| 2.9 | Stub/TODO implementations that look complete | [claude-code#19739](https://github.com/anthropics/claude-code/issues/19739) | TODO/FIXME/not-implemented/single-literal-return greps (audit-hygiene) |

## VCF-3 — Agent-operational incidents

| # | Pattern | Incident anchor | Control here |
| --- | --- | --- | --- |
| 3.1 | False success claims without verification; fabricated incident narratives | [claude-code#19739](https://github.com/anthropics/claude-code/issues/19739) | PLAYBOOK §6 evidence checklist in every WP summary (pr-reviewer verifies) |
| 3.2 | Destructive commands: `rm -rf`, `drizzle-kit push --force` on prod, `migrate reset` | [claude-code#27063](https://github.com/anthropics/claude-code/issues/27063), [#34729](https://github.com/anthropics/claude-code/issues/34729), [Replit prod-DB deletion](https://incidentdatabase.ai/cite/1152/) | Hookify deny-list (see `.claude/hookify.*`); generate+reviewed-migrate only, never push |
| 3.3 | Context loss → parallel re-implementation | [cleanaim](https://cleanaim.com/silent-wiring/problems/context-loss/) | Duplicate-route/schema/constant greps (audit-hygiene) |
| 3.4 | Migration ledger vs folder drift | This repo hit it once (ledger reconciled, 2026-08); [Prisma guidance](https://www.prisma.io/blog/agents-md-for-databases) | Journal-vs-files reconciliation + fresh-DB replay (audit-data) |
| 3.5 | .env mishandling; missing env → tests silently self-skip green | Repo memory: worktree false-green | Skip-count visibility assertion (audit-tests) |
| 3.6 | Over-broad refactors / scope creep | GitClear churn | Diff-vs-WP-scope check (pr-reviewer, audit-architecture) |
| 3.7 | Unneeded/outdated dependency additions | [CSA vulnerability-debt](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-codegen-vulnerability-debt-20260406-csa/) | ADR-per-dependency rule + lockfile-diff gate (audit-devops) |

## VCF-4 — Data-layer incidents

| # | Pattern | Incident anchor | Check (owner agent) |
| --- | --- | --- | --- |
| 4.1 | Destructive migrations (DROP/narrow/NOT NULL without backfill) | claude-code#27063/#34729 | Destructive-SQL grep per migration + expand/contract plan (audit-data) |
| 4.2 | Missing indexes/FKs/constraints in generated schemas | [vibecoding.app audit findings](https://vibecoding.app/blog/vibe-code-audit) | FK/index coverage per query path; EXPLAIN spot-checks (audit-data) |
| 4.3 | No backups / restore never tested (Replit's damage multiplier: agent claimed rollback impossible; PITR existed) | [incidentdatabase.ai/1152](https://incidentdatabase.ai/cite/1152/) | Prod PITR tier confirmed + documented, exercised restore (audit-data, audit-devops) |
| 4.4 | Dev/prod environment mixing | Replit; **this repo: Frankfurt Supabase is prod AND integration-test target** | Test config refuses prod project ref; SEC-07 email sink (audit-devops) |

## VCF-5 — LLM-feature risks (the app's own AI assistant)

The app ships a GenAI feature (admin assistant, BYO tenant keys — ADR-0036), so the
[OWASP Top 10 for LLM Applications](https://genai.owasp.org/) applies to OUR product,
not just our tooling: LLM01 prompt injection (lead Notes are attacker-writable and
flow into context), LLM02 sensitive-information disclosure, LLM05 improper output
handling (widget rendering), LLM06 excessive agency (tool scope), LLM10 unbounded
consumption (budget/rate). Owner agent: **audit-ai-surface**.

## External frameworks worth mining further

- [benavlabs/vibe-check](https://github.com/benavlabs/vibe-check) — 17-category audit checklist for AI-built apps.
- [OpenSSF Security-Focused Guide for AI Code Assistant Instructions](https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions.html) — invert each rule into a check.
- NIST SP 800-218A (SSDF for generative AI) — governance framing.
- [Wiz vibe-coding security fundamentals](https://www.wiz.io/academy/ai-security/vibe-coding-security).
