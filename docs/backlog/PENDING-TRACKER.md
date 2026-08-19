# Pending-work tracker

The single source of truth for what's left, **segregated into slices** so a session can pick one
coherent slice and work similar things together. Status verified against code 2026-08-17. When an
item ships, tick it here AND in its home doc (`CANDIDATES.md`, the capability map, or a WP file).

Legend — Status: ☐ not started · ◐ partial · ✅ done · ⏳ owner-gated. Tier: A (prod
migration/RLS/PII/grant → owner greenlight) · B (no prod-runtime risk) · S (small) · L (large).

Done this session (context): CANDIDATES **C-3, C-4, C-6, C-7, C-8, C-13, C-14, C-21, C-29, C-30,
C-32, C-33** — batches 1–3 of the old queue (PRs #88–#94, migrations 0047–0050 prod-verified).

**UX/CRM effort 2026-08-18 (owner bugs + Slice-5 deferred + fresh audit) — MERGED:**
PR #102 board drag-and-drop rewritten native-HTML5-DnD → **pointer events** (owner: "DnD doesn't
work" — the drop never fired; now robust + touch + testable). PR #103 per-lead **task list no longer
reorders on complete** (stable order — owner misfire fix). PR #104 leads-table density (**partner
name-only** row, dense **tag chips**, Saved-views **Default view** row + Clear-all truthfulness).
PR #105 leads-table **user-adjustable show/hide columns** (per-user pref). PR #106 **dark-mode pass**
(WP-UX-8) + dark chart-hue (WP-UX-4 partial). PR #107 **WP-UX-7 polish**. PR #108 (open) three audit
correctness fixes (board "0"-while-loading header, stale ⚠ suppressed on terminal cards, "Waiting"
false-precision). Design specs + fresh screenshots in `_marketing/audit/` + the session scratchpad.
STILL OPEN from that effort → **Slice 3** (C-10→12 task-assignee, C-24 tags cap/virtualize,
WP-AI-STYLE-PERSIST, C-41 portal perf), **Scope D** AI aesthetic redesign (`ai-redesign-spec.md` ready),
**WP-UX-4** unmatched choropleth labels/legend, and the remaining Scope-E audit findings
(`ux-audit-fresh.md`: timeline raw-enum leak, unmatched 21-vs-1 banner/tile, mobile Partners name clip,
drill-down dead-ends).

**N-slices closeout 2026-08-19 (WP-N1 · WP-NF1 · WP-N2) — ALL THREE SLICES BUILT; Tier B MERGED:**
PR **#131** (WP-NF1 D2–D8: deactivated-seat + SCP-01 role pins on all three emit sites via one shared
`activePartnerSeats`, all-active-seats deterministic fan-out, `assigned_lead` pref entry with an honest
email leg (default off), reminder muted-skip-without-claim (inverts the old pinned test, owner-directed),
task_due/orphaned visual tones, backoff jitter + 10s Resend timeout, optimistic bell + `<time>`,
deep_link redaction with widened idempotency guard, symmetric no-prefs defaults; review round added
server-resolved `assignedPartnerId` at the three notify call sites — PRN-08a shape) · PR **#133**
(WP-N2: AIS-10 follow-up chips, AIS-11 `get_recent_activity` masked + **ops.admin-gated** (audit-tenancy
HIGH: `ai.use` alone would have handed ADMIN_LOCKED audit data to member seats), AIS-12 rate-gate 60s
auto-clear, prompt primitives/data-efficiency blocks, settings copy trimmed in BOTH places; review round
anchored REF_SHAPED to the three real ref shapes + legacy JV-, tenant-pinned the activity actor joins,
un-vacuumed the isolation sweeps) · PR **#134** (WP-N1: TSK-12 inline edit UI with focus-return rule,
TSK-13/C-46 assignee picker + `/api/tasks/assignees` + deactivated-assignee refusal, C-44 fail-closed
`canDo`, C-47 `streamUsersWhere` promoted into scope.ts — SQL-equivalent, scope suites green unmodified,
house rule in ENGINEERING_STANDARDS §2). PR **#132** (WP-NF1 D1 bell-read index, migration 0055) was
**greenlit, MERGED and prod-verified 2026-08-19** (pg_indexes + ledger 56/56 — see Slice 8).
Method: Fable due-diligence → WP specs → 3 parallel Opus worktree agents → pr-reviewer on all four PRs +
audit-tenancy ×3 + audit-design-system ×2, every finding applied or refuted with code evidence → targeted
integration suites green (72/72 NF1 set; C-47 equivalence oracles unmodified) → CI green → Tier B merged.
New candidates C-71–C-83 (C-51–C-70 were minted concurrently by the deep-UX-audit session).

**Slice-3 + Slice-5 closeout 2026-08-18/19 — ALL of the above SHIPPED (PRs #124–#129, all merged,
prod deploys via push-main):** #124 Scope-E correctness batch · #125 WP-AI-STYLE reply quality ·
#126 C-24 tags at scale · #127 WP-UX-4 map labels + ADR-0050 · #128 C-41 perf (a/b/d) · #129 C-11/C-12
task identity + portal panel retirement. Method: Fable-5 design/voice specs (4 parallel passes incl.
mockups) → Opus implementation in per-PR worktrees → pr-reviewer on every PR (+ audit-tenancy on the
two query-path PRs), every finding applied pre-merge → live-verified against the seeded tenant with a
real partner-role portal session. New candidates C-44–C-50 minted; owner-decision list in Slice 8.

---

## Build order (N-slices; consolidated from the Twenty adoption report — updated 2026-08-19)

The canonical execution sequence. Statuses here; per-item detail in CANDIDATES.md / the WP files.
★ = owner-gated before build. **Owner-question queue:** the deep-UX audit's 11 deferred questions
are mapped to gates (memory `jv-leads-owner-question-queue`) — Claude asks them at each slice
kickoff unprompted; answers land in Slice 8.

| # | Slice | Status | Gate |
|---|---|---|---|
| N1 | Finish the work layer (task edit UI + assignee picker) | ✅ **DONE** (PR #134) | — |
| NF1 | Notifications correctness (8 defects) | ✅ **DONE** (PRs #131 + #132, prod-verified) | — |
| N2 | AI batch (chips, activity tool, rate auto-clear, copy) | ✅ **DONE** (PR #133) — clickable lead refs deferred → C-78 | — |
| **N3a** | **Runtime + dead-ends:** C-51 portal hydration fix (+ app-wide Skeleton-in-phrasing sweep) · C-55 public `/terms` + new-tab link · C-57 coverage-map `interactive={isDesktop}` · C-49 coverage-text sweep · Q11 prod-build verify | ✅ **DONE (PR #140, merged 2026-08-19)** — Q11: `next build` exits 0, `/upload` builds fine (crash is dev-Turbopack-only) | ✅ owner answer applied |
| **N3b** | **Systemic primitives:** C-52 hit-target pass (layout-neutral `before:` pseudo-elements; TasksPanel wrapper unharmed) · C-53 `ScrollHint` primitive + adoption (leads/unmatched/imports + portal chip row) · C-54 `ClearFiltersButton` on the three filtered-empties | ✅ **DONE (PR #141, merged 2026-08-19)** — live-browser hit-probed; 44px settle → C-85 | — |
| **N3c** | **Consistency + smalls:** c1 (PR #143): Q3 dual counts + active badge · Q5 row-click both tables · C-60 server task totals · C-56 `?edit=` deep-link · C-69 view-all link — audit-tenancy PASS ×5 areas. c2 (PR #142): Q9 ToS sign-out · Q10 map-caption mobile hide · C-58 · C-61(a–d) · C-63 AuthCardHeader · C-65 dialog pinned title + y-ScrollHint · C-66 · C-67 · C-68 · C-70 · C-48 §1.2 | ✅ **DONE (PRs #142 + #143, merged 2026-08-19)** — C-61(e) deferred (owner eyeball); C-59/C-62 stay out per standing decisions | ✅ all four owner answers applied |
| N4 | Search v2 (Postgres search engine: partial words, ranked, phone-proof — Ctrl-K + leads + portal) | ☐ | **Tier A migration** → parked-PR greenlight |
| NF2 | Notifications v2 (new types, /notifications page, per-user + partner settings, unsubscribe) | ☐ | mockup-light; re-ask Q8 here |
| N5 ★ | Lead record redesign (side panel vs tabs + prev/next N-of-M + inline editing) | ☐ | **layout pick + mockup**; ASK Q1/Q2/Q4/Q7; absorbs C-59 |
| N6 | Leads power tools (bulk select/status/tag "all matching", Update-view, Ctrl-K actions) | ☐ | mockup |
| N7 | Timeline v2 (before → after diffs; person/import/system attribution) | ☐ | — |
| NF3 ★ | Notification rollups (bundle reminders + status floods; due-soon lead time) | ☐ | **owner rollup decision** (Slice 8) |
| N8 | Seller 360 (read-only cross-lead view, never merges) | ☐ | mockup |
| N9 ★ | Deal economics (offer value, close date, lost reason, $ per column) | ☐ | **owner un-skip** |
| N10 ★ | File attachments (private storage, expiring links) | ☐ | **owner revisit** |
| N11 ★ | Automation v1 (if-this-then-that via the notify pipeline + webhooks) | ☐ | **event-seam ADR** |
| N12 ★ | Scale pack (C-43 stored current-status — measured + ADR-scoped, ready; smooth-scroll tables; smart counts) | ☐ armed | **~80k-leads trigger** |
| N13 | Commercialization (Stripe, API keys, webhooks, 2FA, domain auto-join, flags, onboarding, impersonation, tz) | ☐ | **Phase D start** |

**Not in N3 by decision:** C-59 → N5 · C-62 → the Q8 modality call (standing ai-redesign-spec
deferral) · C-55's public route → owner timing vs WP-LGL-1. Audit re-rates recorded 2026-08-19:
H-3 was already fixed by #133 (real High count = 2); C-64 dissolves into C-52/C-53.

## Slice 1 — Hardening & audit closeouts (small, low-risk; batch like batch 1)
Loose ends surfaced by the security/retention work. All independent, mostly Tier B/S — a good
single-PR batch.

| Item | What | Status | Tier |
|------|------|--------|------|
| C-34 (WP-AUTH-OUTAGE-2) | Extend SEC-09 503+Retry-After to `otp/verify` + `trust/refresh` `session_failed` (needs `establishSessionForEmail` tri-state) | ✅ | S |
| C-35 | Backfill missing drizzle snapshots for migrations 0036/0037/0044–0047 (ledger drift) | ✅ | S |
| C-36 | `notifications (tenant_id, lead_ref) WHERE lead_ref is not null` index — **shipped as a plain migration 0052** (table ~6 rows in prod → instant; placed proactively before unpredictable end-user volume, same rationale as 0051). Parked CONCURRENTLY step removed. | ✅ | A (index) |
| C-37 | Fold notifications/outbox redaction counts into the per-lead `lead.pii_purged` audit row | ✅ | S |
| C-38 | Void-path cross-tenant collision test for `redactLeadCommunications` | ✅ | S |
| C-39 | `audit-compliance` pass on the erasure runbook vs all server-side PII sinks (esp. `ai_memory`) | ✅ | S |
| C-40 (WP-RET-4) | **DONE:** erased the 3 PII sinks the purge paths missed — Storage export blob (`voidUpload` `removeExport` on void + `sweepVoidedExports` backstop), `listing_checks.result` (null on void + sweep), `leads.mlsMatchSpan` (in `redactionPatch`). Runbook rows 1/8/9 updated to "erased". | ✅ | A (PII+Storage) |

**Slice-1 status (2026-08-17, `claude/slice-1-hardening`):** C-34/C-35/C-37/C-38/C-39 done + tested;
C-36 is ◐ — ADR-0048 + DM-13 promote the CONCURRENTLY/SQL-only rule, snapshot gaps documented
(`migrations/README.md`), and the index SQL is parked at `src/db/manual/…concurrent.sql`; the index
itself stays deferred (Tier A, owner-gated, seq-scans cheaply today). C-39's audit surfaced 3 real
erasure gaps → spun out as **C-40 / WP-RET-4** (F-1 Storage export is HIGH — a live LGL-02 hole; owner
greenlight to build).

## Slice 2 — Performance · MEASURED 2026-08-18 (`claude/perf-waterfalls-slice2`)
**Measurement (prod `vhoiixmhvuwxfyvxtumz`): 298 leads, max 203/tenant, 1 status-history row total, 0
notes, 2 tasks. All perf advisors are INFO "unused index" (tables too small to index). → the database
is NOT the bottleneck and won't be for a long time. Perceived slowness = latency × per-page round
trips.** The query-plan work (C-16/C-22) is confirmed premature; the wins are latency/round-trip/frontend.

| Item | What | Status | Tier |
|------|------|--------|------|
| **Round-trip waterfalls (done)** | Parallelized the sequential per-request query waterfalls: `getAdminLeadDetail` (5→2 round trips), `getPartnerLeadDetail` (portal, 4→2), `listPartners` (3→1). Behavior-preserving `Promise.all`. | ✅ | B |
| **Frontend flash/over-fetch (done)** | `placeholderData: keepPreviousData` on admin leads table, admin dashboard, portal desktop+mobile leads (no more full-skeleton flash on page/sort/filter/range change); code-split the `/coverage` 0.9 MB county map to match every sibling page. | ✅ | B |
| **C-42 (WP-PERF-AUTH)** | HIGH-value infra: every `/api/*` verifies the JWT **twice over the network** — `proxy.ts` middleware `getUser()` + route `getServerScope()` `getUser()` (GoTrue HTTP calls, ~1 RTT each, not local decodes). **SECURITY AUDIT DONE 2026-08-18 (`docs/audit/2026-08-18-double-jwt-verify.md`): recommend Option A** — swap ONLY the route to `getClaims()` (local verify), keep the edge `getUser()`; reject the "trusted header" option (spoofable). **Owner-gated on dashboard actions: (1) enable asymmetric JWT signing keys — `getClaims()` is a no-op perf-wise until then (silent network fallback on HS256); (2) confirm access-token TTL ≤1h; (3) accept the ≤1h access-token revocation residual (already exists today; role/tenant/partner revocation stays immediate via live DB reads).** On greenlight → route swap + test suite (alg-confusion, expired, cross-tenant, partner-revoke, spoofed-header) as a Tier-A PR. **TRACKER DRIFT NOTE (verified in code 2026-08-18): Option A is SHIPPED — `scope-context.ts` `getServerScope()` verifies via `getClaims()` against a cached JWKS with the HS256/alg-none network fallback, and the header comments cite WP-PERF-AUTH/C-42. The owner dashboard action (enable asymmetric signing keys) remains the switch that makes it a perf win rather than a silent fallback — still ⏳ owner.** | ✅ (code) / ⏳ (owner keys) | A (auth) |
| **Region co-location (done)** | Prod DB is **Frankfurt** (`eu-central-1`); functions defaulted to US → each `/api` request paid ~5–6 serial transatlantic RTTs (auth ×2 + scope + query). **Pinned `vercel.json` `regions:["fra1"]`** to co-locate functions with the DB + GoTrue — a net ~3× per-request latency win even though users are US, because it trades one browser→function hop for many local function→DB hops. Reversible one-liner. | ✅ | B |
| **DB → US region (durable fix)** | Users are US; the co-located `fra1` pin is a stopgap. The durable fix is moving the Supabase project to a US region (e.g. `us-east-1`) so browser + function + DB are all US-local, then repointing `regions` to `iad1`. Prod data migration → **owner** (folds into Slice 7's "US prod Supabase"). | ⏳ | owner |
| **Pooler mode** | Confirm prod `DATABASE_URL` uses the **transaction** pooler `:6543` (serverless-recommended), not session `:5432` (dev `.env.local` uses 5432). Config-only. | ⏳ | owner (verify) |
| C-16 (WP-KAN-1a step 1, done) | **Owner flagged 10k–200k+ scale → re-measured at 50k/200k.** Board = **1,060 ms @ 50k / ~6.7 s @ 200k** today. Shipped: covering index `lead_status_history(lead_id, created_at desc, id desc)` (migration 0051, supersedes `lead_status_lead_idx`) + **board LATERAL rewrite** (one probe/lead not two) + portal `latestStatus` `, id desc` tie-break. Measured **board 1,060→508 ms @ 50k (2×)**. Global search left as-is (its target-list subquery already runs post-`limit`). | ✅ | A (index) |
| **C-43 (WP-KAN-1b) — durable status-at-scale fix** | The LATERAL stopgap holds to **~50–80k**; at **200k every history-derived approach is 5–7 s** (LATERAL hits a random-probe cache cliff, DISTINCT-ON still materializes+sorts all N). Only **denormalizing `current_status` onto `leads`** (indexed) makes the board fast at 100k+ (measured ~sub-second) — but that **dual-writes a derived value → needs an ADR refining PRN-15**, write-path sync (update the column in the same tx as every status change: `portal/status-update.ts` + admin), a backfill migration, and a board/list query redesign using the indexed column. Surface: 4 read paths (admin list+board, portal list, global search) + 2 write sites; analytics partly benefits. Build when a tenant approaches ~80k, OR now if 100k+ is imminent. | ☐ | A (schema+write) |
| C-22 | Global-search CTE bound — **not needed:** for `select …,(subquery) … order by created_at desc limit 10`, Postgres evaluates the target-list subquery AFTER the limit (10 rows), and the 0051 covering index makes each a seek. Revisit only if profiling shows per-matched-row evaluation. | ✅ (n/a) | — |

## Slice 3 — Frontend polish · Tier B — **✅ SLICE CLOSED 2026-08-18/19 (PRs #124–#129)**
| Item | What | Status | Tier |
|------|------|--------|------|
| C-10 → C-11 → C-12 | ✅ **DONE (PR #129).** C-10 shipped in Phase C (#118). C-11: `LeadTaskView` grew `assignee`/`author` identities via tenant+stream-scoped joins (`sameStreamUsers` shared with the write path); TasksPanel shows one identity per row ("You" via `useCurrentUser`), Delete author-only, read-only tiers keyboard-reachably inert; portal passes `canWrite` (partners carry no capability array). C-12: portal "Status history" panel + `history` field retired — Timeline's Status filter is the one story; portal-scope isolation legs migrated onto `activity`. Details in `CANDIDATES.md` C-11/C-12. | ✅ | B |
| C-24 | ✅ **DONE (PR #126).** Cap-not-virtualize: `TAG_LIMIT=100`/tenant under a per-tenant advisory xact lock (409 at cap), bounded `{tags,total,limit}` roster contract, picker keyboard scroll-follow fix + count line + at-cap hint, Settings "N of 100" + usage-count links, `TAG_PALETTE` append-only pinned (TAG-08/TAG-09; audit-tenancy PASS). | ✅ | B |
| WP-AI-STYLE-PERSIST | ✅ **DONE (PR #125).** Persistence had already shipped (ADR-0041, verified: sessionStorage per-tab, cap 40, server stores no content). Reply-quality half: 7-rule prompt rewrite (tone ban-list, refusal-as-policy, id-echo ban, earned follow-up), five-state never-blank fallback matrix (notFound no longer reads as "found it"; miss survives same-label dedup), truthful gate copy (stale budget band killed; no-key vs switched-off split by HTTP status), exhaustive per-screen suggestion chips, `list_imports` masked (SEC-05). AIS-01..09 minted — SPEC.md backfill per the C-20 convention is pending (fold into the next spec-backfill pass). | ✅ | B |
| C-41 | ✅ **(a)(b)(d) DONE (PR #128); (c) deferred** — one fetch per portal view, cache-seeded lead dialogs, merged `/api/leads/counts`; admin loading boundary stays a candidate (layout awaits scope above any boundary). | ✅ | B |

## Slice 4 — CRM feature build (mockup-first; owner picks order, one WP at a time) · Tier A
The remaining capability-map "MUST ADD" / "CAN ADD" items after slices 1–3 shipped (tasks/timeline,
kanban, tags/search/saved-views). Each is its own mockup-first WP.

| Item | What | Status | Tier |
|------|------|--------|------|
| Seller 360 | Read-only aggregate of a seller across leads (reuses `dedupe_key`/`phone_norm`) — owner's flagged next-slice candidate | ☐ | M–L |
| Bulk mass-actions | Extend beyond the existing `assign-bulk` to bulk status/tag/export on the leads grid — owner's flagged candidate | ◐ | M |
| Deal economics | Offer value / close date / lost reason (Dead-requires-reason) — owner-skipped, revisit | ☐ | M (+decision) |
| Tabbed lead record (IA) | Full tabbed record; dialog + Timeline already exist | ◐ | M |
| Configurable/editable stages | Tenant-editable kanban stages (status column already SEAM-06-ready) — deferred polish | ☐ | M |
| File attachments | On leads/tasks — dropped from slice 1 | ☐ | M |
| Phase-2 "CAN ADD" set | Light workflow automation (needs event stream) · email logging+templates · custom fields (EAV) · reporting expansion · multi-seat partner orgs+ACL · calendar · partner pause/vacation · richer notes | ☐ | Varies |

_SKIP (out of scope, not pending): quotes/products · IMAP mailbox + marketing · warehouse/Google
Contacts · round-robin/capacity/shared territories (ASN-02) · full dedup/golden records · AI
doc-extraction · Stripe (→ Phase D)._

## Slice 5 — UX audit remediation
| Item | What | Status | Tier |
|------|------|--------|------|
| **Deep UI/UX audit #2 (2026-08-19)** | Whole-app rubric-graded audit (recommend-only) → **39 findings (0C/3H/17M/19L), candidates C-51–C-70.** Report `_marketing/audit/deep-ux-audit-2026-08-19.md` + artifact + rubric `_marketing/audit-2/`. 5 systemic themes (T-TARGET sub-24px targets/C-52 · T-SCROLLHINT tables/C-53 · T-CLEAR filtered-empty/C-54 · T-CONSISTENCY/C-58,C-61 · T-DEADEND/C-55,C-56). **3 High: C-51 portal-dashboard hydration bug, C-55 signup Terms→login dead-end, AI-usage copy (confirmed-open, already logged).** Admin routes runtime-clean; portal 4/5. 11 deferred-for-owner Qs in the report. **REMEDIATED 2026-08-19 via the N3 slices (PRs #140–#143):** all 3 Highs + the 5 systemic themes + 18 of the 20 candidates shipped; C-59 → N5, C-62 → Q8 standing deferral, C-61(e) owner-eyeball. Follow-on candidates C-84–C-95. | ✅ (via N3) | B/S mostly |
| C-31 (WP-UX-SERIES) | **DONE — MERGED (PR #87, `c4b91cd`).** All 8 slices WP-UX-1..8 shipped (flexible tables, `PageContainer`, kanban flexibility, map/chart honesty, mobile adaptivity incl. the Critical settings-nav, chrome hierarchy, empty-state/copy, dark parity). Details + per-slice deferrals in `docs/backlog/WP-UX-SERIES.md`. (Tracker drift: this row was left ☐ when the tracker was written after the merge.) | ✅ | L |
| WP-UX deferred cuts | Low-risk polish deferred from the 8 slices (per `WP-UX-SERIES.md`). **UX-7 ✅ DONE (PR #107)** · **UX-8 dark-mode pass ✅ DONE (PR #106)** (details in `WP-UX-SERIES.md`). **UX-4 ✅ DONE (PR #127, 2026-08-18):** on-map "XX · N" labels for every gap state on the Unmatched choropleth — opaque `--surface` backing chips per **ADR-0050** (ADR-0024's compliant alternative; the ADR-0029 "no silent revival" gate satisfied), committed 51-entry anchor table `src/lib/geo/us-state-anchors.ts` (offline pole-of-inaccessibility + hand-tuned HI + 9-state seaboard callout column), `HeatLegend` anchored to the real min/max, `role="img"`. **Portal-dark re-capture ✅ DONE (2026-08-18):** captured with a real partner-role shim session (`DEV_SCOPE_ROLE=partner`, capture guard added per fresh-audit §0.1) — portal dark renders soundly, no token change needed. **STILL DEFERRED (owner eyeball only):** dark rim-light shadows (`--sh-sm/md`); `--chart-cat-*` family (ADR). UX-5 admin table→card/dialog-sheet deliberately OUT of scope (≥768px admin contract). | ✅ | B |
| Scope-E audit findings | **✅ DONE (PR #124, 2026-08-18):** timeline raw-enum leak humanized via the shared `lib/match-method` map (UXF-4.2) · dashboard "unmatched" 21-vs-1 → tile relabelled **New unmatched** + linked to `/unmatched`, `HeroKpi` gained `href` (UXF-1.1) · Partners mobile identity (name wraps above refId, min-w floor; zero coverage segments omitted via new `lib/coverage-summary.ts` — roster + House tile) (UXF-10.1/10.2) · global-search "View all N in Leads →" overflow row + Settings→Tags usage-count links (UXF-2.2/11.1, the latter in PR #126). Earlier fresh-audit fixes (board-0, stale ⚠, Waiting precision) were PR #108. Remaining fresh-audit smalls (Clear-all placement, chip dedup, activity filter grammar, rules polish, coverage tweaks, §1.3 percentage rounding) stay WP candidates. | ✅ | B |

## Slice 6 — Roadmap phases (large, owner-sequenced)
| Item | What | Status | Tier |
|------|------|--------|------|
| Phase C — Roles/Permissions/Team | **BUILT 2026-08-18 (5-PR chain).** Model: ADR-0049 — fixed staff tiers admin/member/viewer on the admin STREAM (partner untouched, PRN-13 binary), capability seam `lib/authz.ts` (13 caps, can()/requireCapabilityResponse/requirePassthroughResponse), **tenant-configurable member/viewer capabilities** (role_capabilities, three-band split, editable matrix on the Team page), workspace owner = tenants.owner_user_id ("workspace owner" ≠ ADR-0040 "platform owner"). ✅ **ALL FIVE PRs MERGED (owner greenlit 2026-08-18): #117 seam · #118 cluster-A + useCurrentUser (C-10 closed) · #119 Tier-A migrations 0053/0054 · #120 team page/invites/permissions editor · #121 B–G flips (requireAdminResponse retired from routes).** Prod VERIFIED live via pg_policies: 11 staff-arm allowlist policies, all constraints, RLS on team_invites/role_capabilities, owner backfill 2/2, 0 SCP-08 violations, ledger coherent (55/55, no orphans). Audits: audit-tenancy ×2 + audit-data + pr-reviewer ×3, all findings applied. | ✅ | L |
| Phase D — Commercialize | Self-serve / billing (Stripe) — owner's original "Phase 5" | ☐ | L |
| _Phase B — AI Assistant_ | _✅ built (chat widget + BYO-key encryption); only WP-AI-STYLE-PERSIST remains → Slice 3_ | ✅ | — |

## Slice 7 — Go-live / ops & legal (mostly owner setup)
| Item | What | Status | Tier |
|------|------|--------|------|
| Phase A deploy setup | Real ToS/Privacy text, US prod Supabase (currently Frankfurt shared dev=prod), external uptime watchdog on `/api/health`, main-branch protection, optional Lighthouse gate | ⏳ | owner |
| `AI_KEY_ENCRYPTION_KEY` in Vercel | 32-byte base64; without it the BYO-key UI stays disabled | ⏳ | owner |
| WP-LGL-1 | Publish ToS/Privacy — blocked on owner facts (entity/jurisdiction/emails/effective-date) + attorney review | ⏳ | owner |

## Slice 8 — Owner decisions & hands-on (unblocks the above)
| Item | What | Status |
|------|------|--------|
| Owner hands-on UI pass | Zero owner eyes yet on shipped tasks/timeline/board/tags/search/saved-views | ⏳ |
| **UX effort 2026-08-18 — owner decisions surfaced (deferred, safe defaults applied):** | (1) leads-table **column resize/reorder** — built show/hide only; resize recommended-against (fights the Table fit/clamp budget), reorder = future additive `order` in the same pref. (2) **Roaming/cross-device prefs** — columns use localStorage now; promote the whole prefs blob to a `user_prefs` endpoint if/when Roles-Team lands. (3) **Score/Campaign as default-off columns** — data is already in the row payload; not listed yet (owner call). (4) **Sort-by-hidden-column** — kept the server-side sort (no visible arrow); owner may prefer auto-revert to Received desc. (5) **AI redesign** — mobile scrim, launcher "Ask" copy + breathe cadence, restored-segment divider duration, drag-to-dismiss (from `ai-redesign-spec.md`). (6) **Dark rim-light shadows** (`--sh-sm/md`) + `--chart-cat-*` ADR + **re-capture portal dark** with a partner session. (7) **"Clear all location"** — interpreted as the leads filter-bar "Clear all" leaving a stale saved-view label; fixed that. If the owner meant a different control, flag it. | ⏳ |
| **Slice-3/5 closeout 2026-08-18/19 — owner decisions surfaced (safe reversible defaults applied):** | (1) **Tag cap number** — shipped 100/tenant (justified range 75–150; the API returns `limit` so a per-tenant override is additive later). (2) **Assignee display format** — email local-part truncated ~16ch, bare "You" for self, role tooltip-only (no per-row RoleBadge); the full matrix of alternatives is in the C-11 spec. (3) **Map label rule** — every gap state gets a chip (not top-N); legend anchored in the section header (not an in-map plate); "Fewer/More" wording kept; HI chip sits below the island chain. (4) **AI voice register** — flat operator copy everywhere incl. the no-key band (an invitation tone was the flagged alternative); chip wording as specced. (5) **Raw-enum fix approach** — timeline label re-labelled via the shared display map (no schema rename). All five are copy/const-level reversals if the owner prefers otherwise. | ⏳ |
| ✅ **PR #132 — WP-NF1 D1 bell-read index (migration 0055): GREENLIT + MERGED + PROD-VERIFIED 2026-08-19.** Owner greenlit; merged on green CI; prod verified live via pg_indexes (`notifications_tenant_user_created_idx` + partial `notifications_tenant_user_unread_idx` present with exact definitions, `notifications_user_idx` dropped, tenant + lead_ref indexes intact) and the drizzle ledger (56/56 applied, last = 0055's journal `when` 1787094574008). | ✅ |
| **N-slices closeout 2026-08-19 — owner decisions surfaced (safe reversible defaults applied):** (1) **`assigned_lead` email default = OFF** (the Settings toggle now genuinely works; flipping the default is one line — C-75). (2) **D5 inversion**: a fully-muted task reminder is no longer claimed/burned — the task stays eligible and fires if prefs re-enable; the old behavior was pinned as intended, this was changed on your 2026-08-19 direction — confirm it matches what you meant. (3) **Roster enumeration semantics (TSK-13a)**: `work.write` now implies enumerating same-stream ACTIVE seat emails via the assignee picker; audit-tenancy's accept-and-document default applied — the alternative is a dedicated `work.assign` capability (C-83/C-74). (4) **Assistant audit-trail tool is ops.admin-only** — members keep the assistant but have no audit-trail door, matching the /activity screen's gate; say if you want it laxer. (5) **Multi-seat fan-out**: every active partner seat now gets in-app rows (deterministic); revisit volume defaults before multi-seat orgs are real (C-75). (6) **Typed record references DEFERRED** (PRN-10 analysis in PR #133; safe inverse = C-78). (7) **Picker display**: email local-part, "Me" default, deactivated-assignee server refusal; all const-level reversals. (8) **Edit affordance HIDES on capability miss** (vs Add/Checkbox aria-disable) — documented per-row-noise rationale in code. | ⏳ |
| **N3 closeout 2026-08-19 — ALL FOUR PRs MERGED (#140 N3a · #141 N3b · #142 N3c-chrome · #143 N3c-data); deferred-for-owner (safe reversible defaults applied):** (1) **`/terms` is live NOW with the placeholder ToS text, public + indexable** (your C-55 call); no footer/landing link yet and the "PLACEHOLDER pending finalized documents" sentence is publicly visible — swap point is one file (`lib/legal/tos.ts`) when WP-LGL-1 lands (C-88). (2) **C-57 consequence:** the static phone map also drops tap-to-highlight-a-partner (Partners list beside it stays the touch path — the dashboard already made this exact trade). (3) **C-52 settled at ≥24px** for Checkbox/FilterPill/swatches (44px would steal taps in dense rows); 44px coarse-pointer only on the Dialog ✕; tag-swatch row gap widened 6→8px (tiny visual change) — full 44px pass = C-85. (4) **Reset page:** submit is no longer disabled on password mismatch (blur/submit validation per GOV.UK; the request is still hard-blocked + tested) — say if you prefer the old disabled button. (5) **Settings "General" page retitled "Workspace"** (nav label wins; every sibling already matches its nav word). (6) **Q3 "active" definition pinned** = `mls_status ≠ removed` (test-pinned against the default list; diverges only if tenant-custom statuses ever exist — SEAM-06 note in code). (7) **Map title card now hides on phones on ALL maps** (dashboard/coverage/portal — one primitive), not just /coverage. (8) **C-61(e)** (coverage StatCard anatomy vs HeroKpi) NOT built — visual redesign, your eyeball. (9) Partners `?edit=` open/close does an RSC round trip (C-95) — eyeball in the running app. (10) **Owner hands-on pass of all of N3 still pending** (standing Slice 8 row). | ⏳ |
| ✅ **N3 kickoff decisions 2026-08-19 (owner answered):** (1) **C-55**: public `/terms` page NOW, serving the same ToS text users already accept in-app (an unreadable-but-binding ToS is worse exposure than a visible draft; swap text when WP-LGL-1's attorney version lands) + signup link opens in a new tab. (2) **Q3 expanded**: sidebar leads badge switches from TOTAL to the ACTIVE count (badge semantics change — `/api/leads/counts` gains an active figure) and the Leads page header shows BOTH ("686 active leads · 934 total"). (3) **Q5 expanded**: BOTH tables become whole-row clickable — leads → dialog AND partners → profile (verified: neither was; hover styling misled) — inner controls unaffected; sorting still deferred until roster >~25. (4) **Q9**: Sign-out link on the ToS gate screens. (5) **Q10**: hide the floating coverage title card on phones (§12.1 extension). All Tier B; land inside N3a/N3c. | ✅ |
| C-9 | Portal "Lead received" anchor: keep `firstMatchedAt` vs `coalesce(manual_assigned_at, first_matched_at, created_at)` | ⏳ |
| C-19 (WP-LGL-2) | ToS-gate sweep on admin data routes vs an ADR that page-level acceptance is the boundary | ⏳ |
| C-27 | RLS admin-author asymmetry — harmless watch item; revisit only if the authenticated PostgREST surface becomes load-bearing | ⏳ |
| Reminder rollup vs per-task | Digest vs per-task reminder emails | ⏳ |
| Deal-economics un-skip | Whether to build deal economics (Slice 4) now | ⏳ |
| **Phase C owner decisions (defaults applied, tenant-adjustable via the permissions editor):** GREENLIT + MERGED 2026-08-18. Defaults (tenant-adjustable via the permissions editor): member = leads work + upload + AI, NO void/export/rules/partners; viewer = read-only, no AI; viewer sees admin notes/tasks (PRN-13 is an org wall, not intra-staff); only the workspace owner touches admin seats (OQ-1); ops notifications stay admin-tier; invite expiry 7d; Team page hidden from member/viewer. DEFERRED (candidates): owner-transfer endpoint+UI · pre-acceptance invite role change · "Last active" column · OQ-8 role-change email · SCP-09/SET-08 spec IDs backfill to SPEC.md · WP-SEC-5 users_scope WITH CHECK tightening · typed ESLint role-literal rule · prod drizzle-ledger orphan check (test DB had one, inert). | ⏳ |

## Ongoing — Maintenance / hygiene
| Item | What | Status |
|------|------|--------|
| `/audit full` refresh | Last run 2026-08-05; ~18 PRs stale | ☐ |
| Dependabot holds | Memory notes ~6 held (major bumps); verify current state | ☐ (verify) |

---

**Canonical inventory:** the CRM capability-map artifact (34 items, effort + module tags) is the
exhaustive feature list; this tracker is the actionable, sliced view of what remains.
