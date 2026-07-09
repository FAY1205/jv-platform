# REDESIGN-R3 — Owner feedback + audit remediation program

**Date:** 2026-07-09 · **Status:** Spec approved in session, pending written review
**Inputs:** owner walkthrough feedback (2026-07-09) + full audit `docs/audit/2026-07-09-full.md` (87 findings)
**Branch:** phase-2/distribution · **Baseline SHA:** 81bdebe

This document is the design spec for the R3 program. Each workstream (WS) becomes one or
more WPs with its own implementation plan; this spec fixes scope, decisions, and
acceptance criteria so no WP re-litigates them.

---

## 1. Goals

1. Fix every security/correctness finding from the 2026-07-09 audit that gates real
   partner data (WS-0, WS-10).
2. Bring the admin app to professional SaaS standard per the owner's per-page feedback,
   folding the audit's UX/a11y/perf findings into each page's rework so every screen is
   touched exactly once.
3. Answer the owner's DB question with a formal schema/eventing review (WS-9).
4. Future-proof for the **member role** (limited lead visibility, assigned by admin)
   without building it now.

## 2. Locked decisions

| # | Decision | Consequence |
|---|---|---|
| D1 | **Adopt Radix UI primitives** (headless, styled with existing Tailwind tokens) for Select, DatePicker, DropdownMenu, Dialog, Checkbox | ADR-0016. Replaces hand-rolled Modal and native selects/date inputs. Solves audit focus-trap/keyboard findings structurally. |
| D2 | **Adopt Recharts** for all charts (line, donut) | ADR-0017. No more hand-rolled SVG charts. |
| D3 | **Remove campaign recodes entirely** — pipeline step, `campaign_recodes` table, rules UI, API routes | ADR-0018 + migration. `leads.campaign` column stays (as-imported value). Rules-snapshot hash changes → golden fixtures re-pinned. Audit TR-3 ordering fix then applies to MLS patterns only. |
| D4 | **Ref-ID format v2, true migration** — `UP-2026-011` → `IM-26-011`, `LD-2026-00042` → `LD-26-00042`; `JV-###` unchanged | ADR-0019 + migration. Now-or-never: no production data exists. |
| D5 | **"Delivered" → "Distributed" everywhere** — UI, digests, notifications, run-summary text, Excel export sheet text | Pre-production, so the partner-facing export text changes too. Tests updated in the same WPs. |
| D6 | **Settings scope**: full SaaS baseline + Data & Export + Billing stub + Team stub | See §6. |
| D7 | **Program order**: WS-0 security first → WS-1 foundation → WS-2..8 pages → WS-9 data review → WS-10 pre-deploy gate | Approved by owner. |

## 3. Invariants (unchanged by this program)

- All CLAUDE.md non-negotiables: PRN-01 pipeline purity, PRN-04 MLS anchored regex,
  PRN-05 no historical mutation, PRN-08 scope.ts, PRN-12 tokens-only, PRN-13 note
  streams, PRN-14 never color alone, PRN-15 analytics single home, ASN-02, DM-08, ING-08.
- Working rules: every WS ships its tests; schema change = migration + seed + RLS +
  index in the same PR; Zod on every API input; requirement-ID test names.
- New deps require ADRs (D1–D2 provide them); nothing else is added without one.

---

## 4. Workstreams

### WS-0 — Security & correctness (audit Now-bucket)

Small, independent diffs; land before any redesign work.

| Item | Audit ref |
|---|---|
| `partnerOwnsLead` → effective owner `coalesce(manual_partner_id, partner_id)`; seed TST-01 divergence case (`partnerId=X, manualPartnerId=Y` → X excluded, Y included); PRN-05 overlay assertion test (`editLead` never writes `partnerId`/`matchMethod`) | TR-1 / F-01 |
| Migration 0010: add `manual_partner_id` to the 4 leads RLS policies (incl. `lead_id IN (…)` subqueries) | TR-1 / F-01 |
| `editLead` recomputes `dedupeKey` + `addressNormalized` when address/zip change | F-01 (data facet) |
| Idempotent status update: skip insert + notification when new status = current status | F-12 |
| `RefSchema` validation on `/api/leads/[ref]` GET+PATCH and `/assign` | F-13 |
| `sanitizeCell` on the 3 unsanitized export cell paths (group header, legend, summary) | F-26 |
| Pin MLS pattern load order (`orderBy(patternKey)`); add `mlsPatternKey`/span to golden semantic diff, re-pin | TR-3 / F-03 |
| Fix stale `/runs/` deep-link assertion in `notifications.test.ts`; wire `test:integration` to auto-load `.env.local`; cascade-safe cleanup in `auth-otp.test.ts` | TR-2 / F-02, F-50 |
| Audit-log inserts: `partner.invited`, `partner.session_revoked`; demo seeder stops deleting `audit_log` | TR-5 / F-05 |
| `/dev/emails` page `isProduction → notFound()` | F-48 |
| `pnpm update postcss exceljs` (or `pnpm.overrides` uuid ≥11.1.1) | F-46 |
| Scope-builder sweeps: `findProfileById` tenant predicate in WHERE; `listPartnerActivity` via `partnerOwnsLead`; `drainOutbox` requires `tenantId` | F-31, F-32, F-33 |
| Client cleanups: notif-prefs `invalidateQueries`; `/reset` missing-token link; deactivated-partner re-invite (`canInvite = status !== "active"`, label "Reactivate") | F-79, F-68, F-23 |

**Acceptance:** isolation + portal-scope + unit suites green locally against the dev DB;
the re-route divergence case passes; no `Delivered` behavior changes yet.

### WS-1 — Foundation

Everything the page reworks consume. No page redesign starts before this lands.

1. **ADR-0016 Radix / ADR-0017 Recharts / ADR-0018 recode removal / ADR-0019 ref-ID v2.**
2. **Design tokens v2 (contrast pass):**
   - `--text-3` ≥ 4.5:1 against `--surface`/`--bg` in both themes; badge `warn`/`success`/
     `danger` pairs ≥ 4.5:1 in light theme (re-vet through the EXP-06 palette lens).
   - Type-ramp review for readability (owner: "some fonts hard to read").
   - New unit test in `tokens.test.ts`: computed WCAG contrast assertions so a future
     token edit cannot regress. (Audit F-17, F-18.)
3. **Primitives** (each in `/gallery` with default/hover/focus-visible/active/disabled/
   loading states; Radix-based unless noted):
   - `Select`, `DatePicker`, `DateRangePicker`, `DropdownMenu`, `Checkbox`
   - `Dialog` — replaces `Modal`; focus trap + return-focus built in (F-15); existing
     call sites migrated as their pages are reworked, `Modal` deleted at end of WS-8
   - `Tooltip` — made actually usable app-wide (currently gallery-only)
   - `Pagination` — page controls + rows-per-page select, whitelist {10, 20, 50},
     default 20
   - `ChartContainer` + `LineChart` + `DonutChart` wrappers (Recharts): app tokens,
     styled tooltips, axes, legend, enter transitions; PRN-14 — every series always
     labeled by name in legend and tooltip, never color alone
   - Field primitives regain a visible focus ring (`focus-visible:ring-2`) (F-16)
   - Leads-row keyboard access pattern: ref-id cell rendered as a real button (F-14)
4. **Migrations:**
   - 0011: drop `campaign_recodes` (+ remove pipeline `recode.ts` step, snapshot field,
     rules routes/UI, tests; golden fixtures re-pinned with rationale in the commit)
   - 0012: ref-ID v2 — generators emit 2-digit years with `IM-` prefix for imports;
     migrate stored `uploads.ref_id`, `leads.ref_id`, `audit_log.entity_ref`,
     `notifications.deep_link`; demo-derived text (outbox bodies) refreshed by re-running
     the demo seeder; all `RefSchema` regexes → `/^LD-\d{2}-\d{5,}$/`, `/^IM-\d{2}-\d{3,}$/`;
     fixtures/tests updated
   - 0013: leads indexes — `(tenant_id, created_at)`, `(tenant_id, state)`,
     `(tenant_id, campaign)` (F-09)
5. **Plumbing:** `apiMutate` helper in `src/lib/api.ts` (CSRF header + uniform envelope,
   call sites migrated per-page) (F-82); root `error.tsx`, `global-error.tsx`,
   `not-found.tsx` with trace IDs (F-67).

**Acceptance:** gallery shows every new primitive in all states; token contrast test
green; golden re-pinned once (recodes + ref IDs together); `pnpm check` green.

### WS-2 — Dashboard

- **Trend chart** → Recharts line chart, 3 series: **Leads in, Distributed, Unmatched**.
- **Time filters** → **Last 7 days / Last 30 days / Last 12 months / All time**; chart,
  stat cards, partner table, and source table all obey the selected range. Bucket
  granularity: 7d → daily, 30d → daily, 12mo → monthly, all time → monthly. Comparison
  deltas ("vs prior period") compare against the preceding equivalent window.
- **Vocabulary:** D5 rename lands here (UI + digests + run summary + export text + tests).
- **Partner performance table:** columns Given · Untouched · Contacted · Avg Contact ·
  Closed. Progress bars removed; numeric columns right-aligned with tabular numerals;
  spacing normalized.
- **Avg Contact — definition (single source in `src/modules/analytics`):** mean elapsed
  hours from a lead's distribution to that partner → its first partner action (status
  change or partner note), computed only over leads *with* at least one action in the
  selected range; untouched leads are excluded (they are counted in Untouched instead).
  Display smart-formatted (`3.2h`, `2.1d`); `—` when no contacted leads. An info tooltip
  on the column header states this formula (ANA-03 / F-64 pattern; tooltips also added to
  the other computed stats on this page).
- **Lead source performance:** table (source · imported · removed · removal % · closed)
  + **donut chart** of removed leads per source with counts and percentages, center total,
  labeled legend.
- **Alert banner:** redesigned as compact attention items; renders an explicit error
  state when its query fails instead of "all clear" (F-21).
- **Backend:** dashboard queries aggregate in SQL, bounded by the selected range at the
  SQL layer (F-10); computed in `src/modules/analytics` only (PRN-15).

### WS-3 — Leads

- Table formatting system: consistent paddings, alignment rules (text left, numerics
  right, dates tabular), header treatment — extracted so WS-4/5 tables reuse it.
- **Pagination with rows-per-page (10/20/50, default 20)**; server `pageSize` param
  Zod-whitelisted.
- Filter bar rebuilt on the new `Select`/`DateRangePicker`; filter state isolated so
  keystrokes no longer re-render the table body (F-54).
- Row open is keyboard-accessible (F-14); `LeadDialog` code-split via `next/dynamic`
  (F-56); shared `MatchMethod` client type with exhaustive badge map (F-57);
  raw inputs → `Input` primitive (F-58); `NotesPanel` → `Textarea` primitive + save
  error surfacing + aria-live "Saved" (F-59, F-20, a11y F-6).
- Old read-only `/leads/[ref]` page: the three surfaces that deep-link to it (unmatched,
  import detail, partner profile) switch to opening `LeadDialog` (F-55).

### WS-4 — Unmatched + Imports

- **Map:** state-level only; `CountyCoverageMap` usage (and its ~0.9 MB geometry fetch)
  removed from this page (F-56 facet).
- **Stats row:** total unmatched + per-state counts.
- **Table:** leads-style table (shared formatting system) with an **Assign** action per
  row; server-paginated (kills the unbounded endpoint, F-11); assign modal keeps id-only
  state (F-80).
- **IDs:** imports render as `IM-26-###` (from WS-1 migration).
- **Import detail (`/imports/[ref]`):** redesigned to app design language; "delivered"
  headline stat reads from the server run summary rather than client re-derivation
  (F-75); destructive void modal names the run and explains the reason rule (F-65).

### WS-5 — Partners

- **Roster:** pure management table — name/ref/status/territory summary/contact/actions
  (edit, invite/reactivate, deactivate). Lead-count and untouched columns removed; the
  `healthByPartner` full-history scan is deleted from the roster path entirely (F-10).
- **Profile page (`/partners/[id]`):** hex map replaced with the coverage-style map
  scoped to the partner's territory; layout redesigned; **performance section**: stat
  cards + Recharts history charts (given / contacted / closed over time), Avg Contact
  with the same tooltip formula; per-partner SQL-scoped queries (no roster recompute).
- Partner activity feed uses effective-owner scoping (fixed in WS-0).

### WS-6 — Rules

- Page redesigned around **MLS filter patterns only**: pattern list with enable
  toggles (new `Checkbox`), match-type grouping, pattern-key display, clear
  explanation of what each pattern does; recodes section and coverage card removed
  (D3; owner decision).
- PRN-04 unchanged: regex remains non-editable at runtime; tests extended for the
  removal.

### WS-7 — Settings + Notifications + Profile menu

**Settings IA** (left-nav sections under `/settings`):

| Section | Contents |
|---|---|
| Profile | Name, email (read-only for now), password change (moves the existing `/account/password` flow in) |
| Workspace | Company/workspace name; brand basics placeholder (tokens already support rebrand) |
| Notifications | Existing prefs, rebuilt UI on new primitives |
| Security | Active sessions/devices for the admin (reuses the sessions API), revoke, sign-out-everywhere |
| Appearance | Light/dark theme toggle (`data-theme`; persisted as a UI pref) |
| Data & Export | **Wires the orphaned `color_coding` setting to the export routes** (F-39); retention policy placeholder copy |
| Billing | Stub: plan card, "billing coming soon" empty state |
| Team | Stub: explains the upcoming member role; where invites will live |

**Notification center:** rebuilt dropdown — grouped by day, mark-all-read, per-item read
state, deep links, honest error state (F-21), `aria-live` unread announcements (a11y F-7),
visibility-aware polling (F-87).

**Profile dropdown (top-right):** avatar + name + email header, links (Settings,
Appearance toggle inline, Gallery in dev), sign out. Built on the new `DropdownMenu`.

### WS-8 — Coverage + Activity + shell polish

- **Coverage:** visual polish; map state-label text uses the shared `contrastText`
  helper (F-19); keyboard operability for map interactions or documented companion-list
  pattern (F-69).
- **Activity:** filter bar (event type, actor, date range via `DateRangePicker`),
  search, sortable columns, pagination polish.
- **AppShell:** radii/icon sizes snapped to tokens (F-63); mobile drawer gets
  Esc/focus handling (F-70); `Th` sets `scope` (F-85).
- **Portal quick-fixes:** ≥44 px touch targets on portal buttons (F-66), error states
  on portal lists + lead detail (F-22, F-2 facet), device sign-out error surfacing
  (F-20 facet). Full `PortalShell` chrome is deferred (backlog, F-25).

### WS-9 — Data & eventing review

Deliverables (review + ADR + targeted code, no speculative churn):

1. **Eventing seam ADR:** one written rule for `audit_log` (admin/security evidence,
   append-only) vs `events` (lead lifecycle stream) vs `notifications` (per-user inbox).
   Decides whether `events` earns its keep (gets writers for `lead.assigned` etc. per
   SEAM-04, F-40) or is collapsed. Includes the `audit_log` immutability trigger
   (DB-level UPDATE/DELETE rejection, F-05 facet).
2. **Dead code removal:** unused `analyticsOverview`/`periodSummary` (F-74), dead
   `cookies.ts` session helper (F-29).
3. **`persistRun` batching:** single ref-counter increment + multi-row insert; batch
   listing-check writes (F-08).
4. **Schema verdict:** documented conclusion table-by-table. Expected outcome: no
   further drops beyond `campaign_recodes` (already removed in WS-1); if so, that is
   the recorded answer to the owner's question.

### WS-10 — Pre-deploy gate (before first real partner)

Security headers/CSP (F-06) · outbox cron + heartbeat (F-07) · Sentry + single
per-request traceId (F-07, F-42) · upload `maxDuration` + body-size validation and a
one-off large-file load test (F-07, F-86) · CI hardening: Dependabot, gitleaks, CodeQL,
SHA-pinned actions (F-43–47) · ToS gate enforced at proxy/route layer (TR-4/F-04) ·
**TST-07 portal E2E** — written after the redesign stabilizes, before real partners.

**Owner reality-gate items (not code):** real ToS/Privacy text · sending-domain
SPF/DKIM/DMARC · US production Supabase project + Pro/PITR + restore rehearsal ·
subprocessor list/security page · `main` branch protection.

---

## 5. Future-proofing: member role

Not built in R3. Constraints honored now:
- Settings has a Team stub section where member management will live.
- The WS-0 effective-owner definition is the single scope primitive a member-level
  `assigned_to` visibility rule will extend (one function to widen, not N queries).
- No UI copy hardcodes "the admin" as the only internal user.

## 6. Deferred (tracked, explicitly out of R3)

- Full `PortalShell` chrome + portal redesign (F-25) — partner-side pass after admin R3.
- Async upload progress with step/queue visibility (F-24) — needs background-job
  architecture; interim: staged button labels only if trivial during WS-4.
- First-login product tours (F-84 / UXQ-06).
- Retention sweep implementation (F-37) — placeholder copy in Settings → Data only.
- `tos_acceptances` tenant-scoping decision (F-30) — Phase 5.
- EXP-06 palette-manager distance warnings (F-60) — the WS-1 contrast test covers the
  static pool; roster-growth warning deferred.

## 7. Audit traceability

WS-0 closes: F-01, F-02(partial), F-03, F-05(partial), F-12, F-13, F-23, F-26, F-31,
F-32, F-33, F-46, F-48, F-50, F-68, F-79.
WS-1 closes: F-09, F-15, F-16, F-17, F-18, F-62, F-67, F-82 (+ D3/D4 migrations).
WS-2..8 close: F-10, F-11, F-14, F-19, F-20, F-21, F-22, F-39, F-54–F-59, F-63, F-64,
F-65, F-66, F-69, F-70, F-75, F-80, F-85, F-86, F-87 (each folded into its page WS).
WS-9 closes: F-08, F-29, F-40, F-74, F-05(trigger facet).
WS-10 closes: F-04, F-06, F-07, F-42, F-43–47, F-02 (TST-07).
Remaining audit items stay on the backlog register with their original IDs.

## 8. Acceptance for the program

1. All WS-0 items green against the dev DB before WS-2 starts.
2. Every reworked page uses only WS-1 primitives (no raw selects/inputs/modals left on
   touched pages) and passes the token contrast test.
3. `pnpm check` green per WP; golden re-pinned exactly once (WS-1) with rationale.
4. Owner walkthrough sign-off per page WS — same format as the 2026-07-09 session.
