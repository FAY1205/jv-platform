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

---

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
| **C-42 (WP-PERF-AUTH)** | HIGH-value infra: every `/api/*` verifies the JWT **twice over the network** — `proxy.ts` middleware `getUser()` + route `getServerScope()` `getUser()` (GoTrue HTTP calls, ~1 RTT each, not local decodes). Fix = local JWT verification via asymmetric signing keys + `getClaims()` (needs Supabase key config + security review) and/or don't re-verify in the route. Owner-gated (auth). | ☐ | A (auth) |
| **Region co-location (done)** | Prod DB is **Frankfurt** (`eu-central-1`); functions defaulted to US → each `/api` request paid ~5–6 serial transatlantic RTTs (auth ×2 + scope + query). **Pinned `vercel.json` `regions:["fra1"]`** to co-locate functions with the DB + GoTrue — a net ~3× per-request latency win even though users are US, because it trades one browser→function hop for many local function→DB hops. Reversible one-liner. | ✅ | B |
| **DB → US region (durable fix)** | Users are US; the co-located `fra1` pin is a stopgap. The durable fix is moving the Supabase project to a US region (e.g. `us-east-1`) so browser + function + DB are all US-local, then repointing `regions` to `iad1`. Prod data migration → **owner** (folds into Slice 7's "US prod Supabase"). | ⏳ | owner |
| **Pooler mode** | Confirm prod `DATABASE_URL` uses the **transaction** pooler `:6543` (serverless-recommended), not session `:5432` (dev `.env.local` uses 5432). Config-only. | ⏳ | owner (verify) |
| C-16 (WP-KAN-1a step 1, done) | **Owner flagged 10k–200k+ scale → re-measured at 50k/200k.** Board = **1,060 ms @ 50k / ~6.7 s @ 200k** today. Shipped: covering index `lead_status_history(lead_id, created_at desc, id desc)` (migration 0051, supersedes `lead_status_lead_idx`) + **board LATERAL rewrite** (one probe/lead not two) + portal `latestStatus` `, id desc` tie-break. Measured **board 1,060→508 ms @ 50k (2×)**. Global search left as-is (its target-list subquery already runs post-`limit`). | ✅ | A (index) |
| **C-43 (WP-KAN-1b) — durable status-at-scale fix** | The LATERAL stopgap holds to **~50–80k**; at **200k every history-derived approach is 5–7 s** (LATERAL hits a random-probe cache cliff, DISTINCT-ON still materializes+sorts all N). Only **denormalizing `current_status` onto `leads`** (indexed) makes the board fast at 100k+ (measured ~sub-second) — but that **dual-writes a derived value → needs an ADR refining PRN-15**, write-path sync (update the column in the same tx as every status change: `portal/status-update.ts` + admin), a backfill migration, and a board/list query redesign using the indexed column. Surface: 4 read paths (admin list+board, portal list, global search) + 2 write sites; analytics partly benefits. Build when a tenant approaches ~80k, OR now if 100k+ is imminent. | ☐ | A (schema+write) |
| C-22 | Global-search CTE bound — **not needed:** for `select …,(subquery) … order by created_at desc limit 10`, Postgres evaluates the target-list subquery AFTER the limit (10 rows), and the 0051 covering index makes each a seek. Revisit only if profiling shows per-matched-row evaluation. | ✅ (n/a) | — |

## Slice 3 — Frontend polish · Tier B
| Item | What | Status | Tier |
|------|------|--------|------|
| C-10 → C-11 → C-12 | `useCurrentUser()` hook / scope on the lead payload → task assignee avatar+name → retire the portal's legacy "Status history" panel (C-10 unblocks C-11) | ☐ | B |
| C-24 | Cap/paginate `GET /api/tags`, virtualize `TagPicker`, per-tenant tag limit, pin the `TAG_PALETTE` append-only contract with a test | ☐ | B |
| WP-AI-STYLE-PERSIST | Assistant reply quality (no blank replies / raw paths / clearer chips / tone) + chat panel & transcript survive nav/refresh | ☐ | B |

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
| C-31 (WP-UX-SERIES) | **DONE — MERGED (PR #87, `c4b91cd`).** All 8 slices WP-UX-1..8 shipped (flexible tables, `PageContainer`, kanban flexibility, map/chart honesty, mobile adaptivity incl. the Critical settings-nav, chrome hierarchy, empty-state/copy, dark parity). Details + per-slice deferrals in `docs/backlog/WP-UX-SERIES.md`. (Tracker drift: this row was left ☐ when the tracker was written after the merge.) | ✅ | L |
| WP-UX deferred cuts | Low-risk polish deferred from the 8 slices (per `WP-UX-SERIES.md`). **UX-7 ✅ DONE (PR #107):** scoring-card range/badge fixed-width slots + "Required: Yes" dedup (annotate only the Mortgage exception), Tags create-row colour picker (+ "Auto" default), portal "My Tasks" title de-dup (`MyTasksList title` prop). **UX-8 dark-mode pass ✅ DONE (PR #106):** map stroke theme-parity + non-territory land raised (new `--map-line`/`--map-land`/`--map-land-line` token pairs, zero light change), portal `--border-soft` hairline lift, dark donut brand/warn collapse fixed (→`--info`). **UX-8 DEFERRED (owner):** dark rim-light shadows (`--sh-sm/md`) — aesthetic eyeball; `--chart-cat-*` family (ADR); re-capture PORTAL dark screenshots with a partner session (the audit-run portal captures were admin redirects). **UX-4 STILL OPEN:** on-map choropleth labels + anchored min/max legend on Unmatched (needs state centroids). UX-5 admin table→card/dialog-sheet deliberately OUT of scope (≥768px admin contract). | ◐ | B |

## Slice 6 — Roadmap phases (large, owner-sequenced)
| Item | What | Status | Tier |
|------|------|--------|------|
| Phase C — Roles/Permissions/Team | Real roles beyond admin/partner + the team-management page (currently a "coming soon" stub); touches many screens | ☐ | L |
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
| C-9 | Portal "Lead received" anchor: keep `firstMatchedAt` vs `coalesce(manual_assigned_at, first_matched_at, created_at)` | ⏳ |
| C-19 (WP-LGL-2) | ToS-gate sweep on admin data routes vs an ADR that page-level acceptance is the boundary | ⏳ |
| C-27 | RLS admin-author asymmetry — harmless watch item; revisit only if the authenticated PostgREST surface becomes load-bearing | ⏳ |
| Reminder rollup vs per-task | Digest vs per-task reminder emails | ⏳ |
| Deal-economics un-skip | Whether to build deal economics (Slice 4) now | ⏳ |

## Ongoing — Maintenance / hygiene
| Item | What | Status |
|------|------|--------|
| `/audit full` refresh | Last run 2026-08-05; ~18 PRs stale | ☐ |
| Dependabot holds | Memory notes ~6 held (major bumps); verify current state | ☐ (verify) |

---

**Canonical inventory:** the CRM capability-map artifact (34 items, effort + module tags) is the
exhaustive feature list; this tracker is the actionable, sliced view of what remains.
