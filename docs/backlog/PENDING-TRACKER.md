# Pending-work tracker

The single source of truth for what's left, **segregated into slices** so a session can pick one
coherent slice and work similar things together. Status verified against code 2026-08-17. When an
item ships, tick it here AND in its home doc (`CANDIDATES.md`, the capability map, or a WP file).

Legend — Status: ☐ not started · ◐ partial · ✅ done · ⏳ owner-gated. Tier: A (prod
migration/RLS/PII/grant → owner greenlight) · B (no prod-runtime risk) · S (small) · L (large).

Done this session (context): CANDIDATES **C-3, C-4, C-6, C-7, C-8, C-13, C-14, C-21, C-29, C-30,
C-32, C-33** — batches 1–3 of the old queue (PRs #88–#94, migrations 0047–0050 prod-verified).

---

## Slice 1 — Hardening & audit closeouts (small, low-risk; batch like batch 1)
Loose ends surfaced by the security/retention work. All independent, mostly Tier B/S — a good
single-PR batch.

| Item | What | Status | Tier |
|------|------|--------|------|
| C-34 (WP-AUTH-OUTAGE-2) | Extend SEC-09 503+Retry-After to `otp/verify` + `trust/refresh` `session_failed` (needs `establishSessionForEmail` tri-state) | ☐ | S |
| C-35 | Backfill missing drizzle snapshots for migrations 0036/0037/0044–0047 (ledger drift) | ☐ | S |
| C-36 | Add `notifications (tenant_id, lead_ref) WHERE lead_ref is not null` index via `CREATE INDEX CONCURRENTLY` (out-of-tx, manual prod apply) | ☐ | A (index) |
| C-37 | Fold notifications/outbox redaction counts into the per-lead `lead.pii_purged` audit row | ☐ | S |
| C-38 | Void-path cross-tenant collision test for `redactLeadCommunications` | ☐ | S |
| C-39 | `audit-compliance` pass on the erasure runbook vs all server-side PII sinks (esp. `ai_memory`) | ☐ | S |

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
| C-16 + C-22 (WP-KAN-1a) | **DEFERRED — measured zero benefit at current volume.** At-scale fix for when a tenant grows (LATERAL rewrite of the correlated `latestStatus`/`latestAt` subqueries + covering index `lead_status_history(lead_id, created_at desc, id desc)` + push status filter into the board CTE + global-search limit CTE, incl. the portal's parallel copy + `, id desc` tie-break; alias trap noted). Trigger: a tenant's leads×status-history grows enough that `EXPLAIN ANALYZE` shows the per-row subplan dominating (measured 8ms/44-loops at 934 leads/1392 status rows in the test DB — still trivial). Index add is Tier A + CONCURRENTLY out-of-tx (DM-13). | ☐ (deferred) | A (index) |

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
| C-31 (WP-UX-SERIES) | 8 slices (WP-UX-1..8); 3 mockup-first; WP-UX-5 carries the one Critical (mobile settings nav) | ☐ | L |

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
