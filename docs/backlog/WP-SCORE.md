# WP-SCORE-1/2/3: Lead scoring + hot-lead alerts
Spec: SCR-01..12 (SPEC §6.4a), PRN-01/12/14/15, DM-08, ADR-0026, SEC-05 · Phase: post-2 · Tier: A

## Goal
Score every kept lead 0–50 from the RESIDI scoring workbook at import, surface the Hot
ones with a small target mark + a Rules-page explanation + a Hot filter, and alert the
admin (instant) and the assigned partner (hold-aware) when a hot lead lands.

## WP-SCORE-1 — engine + schema + extraction + Rules page
- [x] `src/modules/pipeline/score.ts` — PURE `scoreLead(input)` + `extractScoringInput()`,
      the fixed `SCORING_SCHEME` descriptor, `SCORING_VERSION`. Workbook Formula-Tests pinned.
- [x] `planRun` computes a score per lead; `process`/`store` persist it.
- [x] Migration 0032: `score_total`, `score_group`, `score_status`, `score_breakdown`
      on `leads` + `leads_tenant_score_idx`. RLS: covered by the existing `leads` policy
      (row-level; column adds need no new policy). Seed: n/a.
- [x] `scoringVersion` added to the rules snapshot (DM-08); golden hash regenerated.
- [x] Rules page renders the scheme from `SCORING_SCHEME` (read-only); a unit test locks
      the descriptor to the engine so docs can't drift.
- Tests: `tests/unit/score.test.ts`, `run-snapshot.test.ts` (scoringVersion), `golden.test.ts`.

## WP-SCORE-2 — icon, dialog badge, Hot filter, default status filter
- [x] `HotLeadMark`/`HotLeadIcon` (hand-drawn concentric-circle target, amber, PRN-14
      accessible label). Rendered ONLY for a kept, Hot lead (no mark on MLS-removed).
- [x] Admin + portal (desktop + mobile) lead lists show the mark; lead dialog shows the
      "Hot · N/50" badge + criterion breakdown.
- [x] `hot` query param + Hot filter pill on the admin leads page; `?hot=1` deep link.
- [x] Default leads status filter = all workflow statuses EXCEPT "Removed MLS" (owner).
- Tests: `tests/unit/leads-query-schema.test.ts` (hot param + default-status helper),
  `score.test.ts` (scheme lock).

## WP-SCORE-3 — hot-lead notifications
- [x] `hot_leads` notification kind + prefs (both roles, default email + in-app on).
- [x] Admin alert at import (all hot kept leads incl. house + unmatched); partner alert at
      distribution-release, per non-house partner (house/unmatched hot ⇒ admin only).
- [x] `buildAdminHotAlert`/`buildPartnerHotAlert` (SEC-05: refId + location + score only).
      Admin deep link is `/leads?hot=1`.
- Tests: `tests/unit/digests.test.ts`, `notification-prefs.test.ts`.

## Out of scope (WP candidates)
- Backfill scores for pre-existing leads (only new imports are scored).
- Tenant-editable scoring scheme (DM-08 snapshot per edit) — v1 is fixed in code.
- Per-lead (vs per-import) real-time hot alerting.
- `audit_log`/`email_outbox`/`notifications` retention pruners (unbounded growth).
