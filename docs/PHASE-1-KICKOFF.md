# Phase 1 kickoff prompt (paste into a fresh session)

> Start **Phase 1 — the pipeline spine** of the JV Platform. Phase 0 is complete and
> committed on branch `phase-0/foundations` (106 tests green; the dev Supabase DB is
> live with 22 RLS tables + seeds). Before coding, read `CLAUDE.md`, `docs/SPEC.md`
> §6.1–6.6 and §11, `docs/PLAYBOOK.md`, `docs/traceability-phase-0.md`, and
> `docs/sources/investorfuse-format.md`. Follow the risk-tiered review cadence
> (Tier A = plan for my approval first). The goal of Phase 1: turn an uploaded weekly
> file into distributed, colored Excel output, deterministically, with per-lead audit
> reasons — wiring the pieces Phase 0 already built.
>
> **Real sample files are available** (InvestorFuse CRM exports, 61 cols, ~50 rows each):
> `C:\Users\User\Downloads\investorfuse-opportunity-export (27).xlsx` and `(26).xlsx`.
> They hold **real seller PII — never commit them**; read them locally only, and produce
> an **anonymized** hand-verified week for the TST-05 golden. A git-ignored `.samples/`
> dir exists for dropping local copies.
>
> **First, resolve the load-bearing open question:** the export has both a `Notes` (col 39)
> and a `Comments` (col 40) column. Inspect the real cell contents locally to determine
> which carries the "is it listed on MLS?" text the MLS filter reads (or whether to
> concatenate both into the canonical `notes` field), and confirm with me before wiring MLS.
>
> **Build order (mostly Tier A — plan each Tier-A WP first):**
> 1. Real **InvestorFuse Source Profile v1** (mapping in `docs/sources/investorfuse-format.md`) replacing the demo placeholders; parse the real .xlsx (install SheetJS `xlsx`; client preview parse in a Web Worker, FEP-06).
> 2. **Assignment** (ASN-01/02, Tier A): exact ZIP → state fallback → unmatched. No special-case partner code — regional exceptions emerge from ZIP precedence.
> 3. **Dedupe & history** (DED, Tier A): match on `dedupe_key`, phone secondary; previously-matched flagged, original partner + first-matched date retained (PRN-05).
> 4. **Recode** (EXP-01) + **export renderer** (install `exceljs`; colored/grouped rows, `JV_Color_Legend` + `Run_Summary` sheets, fixed column contract EXP-02, SEC-06 formula-injection sanitization, color ON/OFF EXP-06).
> 5. **Void-run** (ING-09); **upload flow** with template panel + honest step progress (UXQ-02); **leads** + **unmatched** views (built from the WP-004 component library).
> 6. **Run summary** on screen + in the export (EXP-04).
>
> **Ready to wire in:** `src/modules/pipeline/{mls,normalize,lock}.ts`, `src/modules/sources/*`,
> `src/lib/{scope,idempotency}.ts`, `src/db/*` (client, schema, `ref-ids.ts` for reference-ID
> allocation). To run DB commands, load `.env.local` into the shell env first (shell state
> doesn't persist between tool calls).
>
> **Exit gate (spec §11):** TST-05 semantic zero-diff vs the hand-verified week; I process
> one real week end-to-end. Everything runs on the pure engines already proven in Phase 0.
>
> Start by reading the specs and the InvestorFuse format doc, then propose the Phase 1 WP
> breakdown and the plan for WP-013 (real Source Profile + xlsx parse) for my approval.

## Still owner-provided later (not blockers for starting)
- Confirm the real partner seed list (names, emails, phones, locked colors) — needed for Phase 2 onboarding.
- Sending-domain DNS (SPF/DKIM/DMARC) for Resend — before Phase 2 digests.
- ToS + Privacy Policy — before Phase 2 partner onboarding.
