# Phase 2 kickoff prompt (paste into a fresh session)

> Start **Phase 2 — Distribution** of the JV Platform. Phase 1 is complete and **live-verified**
> on branch `phase-1/spine` (14 commits; 184 unit tests + 10 live DB-integration tests green).
> The pipeline spine works end-to-end: upload a weekly file → parse (Web Worker) → detect
> InvestorFuse → normalize → MLS → recode → assign → dedupe → persist (scoped, advisory-locked,
> rules-snapshotted) → colored partner-grouped Excel + on-screen routing ledger, with void-run
> and a TST-05 golden zero-diff gate.
>
> **Before coding, read:** `CLAUDE.md`, `docs/SPEC.md` **§6.7–6.11, §6.18–6.20, §7, §8, §11**,
> `docs/PLAYBOOK.md`, the Phase-1 backlog `docs/backlog/WP-013…022*.md`, and your auto-memory
> (`MEMORY.md` → `jv-leads-project.md`). Follow the risk-tiered cadence (**Tier A = plan for my
> approval first**), TDD, per-WP self-audit, and **show-me-a-preview-first** for any UI.
>
> **DB connection:** `.env.local` `DATABASE_URL` now points at the **EU session pooler**
> (`aws-0-eu-central-1.pooler.supabase.com`) — the direct `db.<ref>.supabase.co` host is IPv6-only
> and won't resolve here. Load `.env.local` for DB commands. Integration tests self-skip without it;
> run them with: `node --env-file=.env.local ./node_modules/vitest/vitest.mjs run tests/integration`
> (10 tests; vitest timeout is already raised to 30s for pooler latency).
>
> **Goal of Phase 2:** the distribution layer — real auth, partner portal (email-OTP onboarding +
> ToS), two-stream notes, digests + notification center, partners/coverage/rules admin screens,
> LinkOnly listing check, and activity views. **Exit gate (§11):** ≥ 3 real partners active
> (added in-app) and one week processed fully in-app.
>
> **FIRST and load-bearing — replace the dev-scope stub with real auth.** `src/lib/scope-context.ts`
> currently hardcodes the dev tenant as admin (a Phase-1 stopgap). Every scoped view and the whole
> portal depend on real Supabase Auth + `getServerScope` resolved from the session (JWT
> app_metadata claims: tenant/role/partner). Start with **WP-023** (Tier A — plan first): Supabase
> Auth wiring, real `getServerScope`, admin password login, secure cookies/session, `no-store` on
> authed pages.
>
> **WP breakdown (WP-023 → 035, ~13 WPs, ~2 weeks):**
> - **023** Supabase Auth + real `getServerScope` + admin login (AUT-01/02/05/09/12/13) — Tier A
> - **024** Auth hardening: rate-limit · lockout+notify · reset · session-fixation · logout revocation · CSRF · sessions table (ACC-02) (AUT-03/04/06/07/14) — Tier A
> - **025** Partner onboarding (PTL-01): invite → branded email → 6-digit email-OTP → ToS acceptance (LGL-01) → trusted device (AUT-10) — Tier A
> - **026** Partner portal: scoped leads/statuses views, status→history+events, own-leads export (PTL-02/03/04) — Tier B\*
> - **027** Notes: two mutually-invisible streams, append-with-edit (audited) (NTS, PRN-13, TST-08) — Tier A
> - **028** Digests: outbox (delivery/retry) + Resend, per-partner upload digest, admin summary (NTF-01/02/03) — Tier A
> - **029** Notification center + per-event prefs (NTF-04/05, SET-03) — Tier B
> - **030** Partners CRUD + deactivation→reassignment prompt (ADM-03, PRN-05) — Tier A
> - **031** Coverage import: spreadsheet → diff preview → versioned/revertible/audited (CVG-01/03, DM-06/08) — **the deferred real ZIP coverage** — Tier A
> - **032** Rules area: state rules / MLS patterns / recodes / Source Profiles editable+versioned (CVG-02, SET-12, DM-08); folds in the WP-020 drift/mapping UI (ING-08) + template panel (ING-05) — Tier A
> - **033** Listing check LinkOnly (LST-01/02/03, SEAM-02) — Tier B
> - **034** Activity views: admin audit surface + partner activity (ACT-01/02/04) — Tier B
> - **035** Phase-2 gate: ≥3 real partners active, one week fully in-app + traceability audit — owner-gated
> - **Storage** (SEC-02/03, EXP-05, ING-01): original + export blobs to Supabase Storage + signed URLs + upload constraints — attach to WP-026/028 (replaces Phase-1 regenerate-on-download).
>
> **Ready to wire in:** `src/lib/auth/*` (Phase-0 primitives — hash, otp, reset-token, refresh,
> lockout, enumeration, constant-time, cookies, password), `src/lib/scope.ts` (the guard),
> `src/lib/scope-context.ts` (the stub to replace), `src/modules/run/*` (the built spine),
> `src/modules/notify/email.ts` (the non-prod email sink), `src/db/*`, the WP-004 component library,
> and the Phase-1 API/route + TanStack Query patterns (`src/app/api/*`, `src/lib/http.ts`, `src/lib/api.ts`).
>
> **Carry-forward follow-ups:** (a) WP-018 schema — make `leads(tenant, dedupe_key)` a **partial**
> unique index `WHERE deleted_at IS NULL` and soft-delete voided leads, so a corrected lead can be
> re-uploaded after a void; (b) the real-week **golden hand-verification** + one real week end-to-end
> is still the owner-pending Phase-1 §11 gate (`tests/fixtures/investorfuse-week-golden.json` is a
> pipeline-generated provisional baseline).
>
> Start by reading the specs, confirm the branch (suggest `phase-2/distribution` off `phase-1/spine`),
> then propose the **WP-023 plan** for my approval.

## Owner items — reality-gate, NOT build blockers
Development proceeds on seeds, the email sink, sample coverage, and placeholder ToS. These are only
needed to onboard **real** partners / run a **real** week (the Phase-2 exit gate):
- **Partners are added in the app** (ADM-03 / WP-030) — no pre-supplied list needed; dev uses the 9
  seeded palette partners + dummies. Real names/emails/phones/locked colors get entered in-app when onboarding.
- **ToS + Privacy Policy** documents (LGL-01) — placeholder text is fine for build/test; real docs before real partners.
- **Sending-domain DNS (SPF/DKIM/DMARC)** for Resend — the non-prod email sink intercepts everything in dev; DNS only for real delivery.
- **Real ZIP-coverage spreadsheet** — imported via WP-031; dev distributes on sample coverage. This is what makes a real *national* week route correctly.
- **Supabase Auth config** — enable email OTP + redirect URLs on the dev project (needed to exercise WP-023/025 login).
