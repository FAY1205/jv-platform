# Next-session kickoff — Continue Phase 2 (WP-028 →)

Paste the block below to start the next session.

---

Continue Phase 2 — Distribution (WP-028 →). The auth + partner-portal spine is DONE and
live-verified on branch `phase-2/distribution` (off `phase-1/spine`): WP-023–027 + a
self-review fix + UX fixes. 235 unit + ~30 live DB-integration tests green;
typecheck/lint/build clean. **GitHub:** private repo `github.com/FAY1205/jv-platform`,
review PR #1 (`phase-2/distribution` ← `phase-1/spine`).

**Before coding, read:** `CLAUDE.md`; `docs/SPEC.md` **§6.10 (NTF), §6.11 (ANA/MAP),
§6.20 (ACT), §7 (ADM/CVG), §8 (SET), §11**; `docs/PLAYBOOK.md`; `docs/backlog/WP-023…027*.md`;
and auto-memory `MEMORY.md` → `jv-leads-project.md`. Follow the risk-tiered cadence
(**Tier A = plan for approval first**), TDD, per-WP self-audit, and live-verify each WP
against the dev DB.

**CRITICAL — the owner is NON-TECHNICAL.** They never review code; they accept work by
**using the app**. For every WP: verify it yourself (tests + drive the flow), then give
plain, numbered "click here → you should see this" steps. Never ask them to read diffs.

**DB/env:** `.env.local` `DATABASE_URL` = EU session pooler; Supabase Auth keys are set.
Integration tests self-skip without it:
`node --env-file=.env.local ./node_modules/vitest/vitest.mjs run tests/integration`.

**Run the app for the owner:** `pnpm build && pnpm exec next start -p 4000` →
http://localhost:4000 (Next 16 allows only ONE `next dev` per folder; use `next start`
on a spare port, backgrounded). Dev admin: `dev-admin@dev-jv.test` /
`Dev-Admin-Pass-2026!x`. Sample data seeded (`scripts/seed-sample-coverage.ts` +
`scripts/seed-sample-run.ts` → UP-2026-001).

**Git push:** `gh` is installed + authed (FAY1205) but not on the Bash-tool PATH — push
via the PowerShell tool with `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine")
+ ";" + [Environment]::GetEnvironmentVariable("Path","User"); git push origin phase-2/distribution`.

**⚠️ FIRST, unblock partner-portal testing:** all dev email goes to the SEC-07 sink, so
the owner can't receive the partner OTP / reset links. **Build a tiny dev-only "sent
emails" viewer** (non-prod page listing what the sink captured — OTP codes, reset links,
invites) so the owner can self-test onboarding/reset/partner-portal end-to-end. Small,
high-value, do it early.

**Remaining Phase-2 WPs (8):**
- **028** Digests: outbox (delivery status, retry+backoff) + Resend behind the existing
  `sendEmail` seam; per-partner upload digest + admin run-summary (NTF-01/02/03). **Fold
  in Storage** (SEC-02/03, EXP-05): original + export blobs to Supabase Storage + signed
  URLs (replaces regenerate-on-download). — Tier A
- **029** Notification center + per-event prefs (NTF-04/05, SET-03) — Tier B
- **030** Partners CRUD + invite UI + deactivation→reassignment prompt (ADM-03, PRN-05).
  **HIGH LEVERAGE — this is what lets the owner add real partners in-app (the exit gate).** — Tier A
- **031** Coverage import: spreadsheet → diff preview → versioned/revertible/audited
  (CVG-01/03, DM-06/08) — the deferred real ZIP coverage — Tier A
- **032** Rules area: state rules / MLS patterns / recodes / Source Profiles editable+versioned
  (CVG-02, SET-12, DM-08); folds in the WP-020 drift/mapping UI (ING-08) + template panel (ING-05) — Tier A
- **033** Listing check LinkOnly (LST-01/02/03, SEAM-02) — Tier B
- **034** Activity views: admin audit surface + partner activity (ACT-01/02/04) — Tier B
- **035** Phase-2 exit gate: ≥3 real partners active (added in-app) + one week fully in-app
  + traceability audit — owner-gated

**Suggested order:** dev email viewer → **WP-030 (partners CRUD + invite)** → 028 (digests)
→ 029/031/032/033/034 → 035. (Or ask the owner.)

**Ready to reuse:** the auth/scope stack (`src/lib/scope*`, `src/lib/auth/*`, `src/proxy.ts`),
the notes module + `NotesPanel`, the portal module (`src/modules/portal`), the email sink +
`sendEmail` seam (`src/modules/notify/email.ts`, `src/lib/auth/notify.ts`), `events` +
`audit_log` tables, the `logError` seam (`src/lib/observability.ts`), the component library +
TanStack Query patterns, `renderExport` (colored xlsx), and the run spine (DrizzleRunStore).

**Carry-forward follow-ups:** (a) WP-018 schema — partial unique index
`leads(tenant, dedupe_key) WHERE deleted_at IS NULL` + soft-delete voided leads (re-upload a
corrected lead after a void); (b) the Phase-1 §11 gate is still owner-pending — hand-verify the
golden + process one real (non-anonymized) week end-to-end (best after WP-031 real coverage);
(c) NTS-03 export "JV Notes" column mapping (a setting); (d) a `Textarea` primitive for the library.

**Start by:** reading the specs + memory, confirm the branch (`phase-2/distribution`), then
propose the plan for the **dev email viewer** (small) and **WP-030** for approval.
