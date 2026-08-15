# WP-S3 series: Tags · Global Search · Saved Views (CRM slice 3)

Spec: TAG-01..07, SRCH-01..05, SV-01..05 · Phase: CRM-3 · Mockup: approved 2026-08-15
(artifact 2a393b5b) · Deal economics explicitly SKIPPED by owner (2026-08-15).

## Owner decisions locked at mockup sign-off

- **Hot is a SMART TAG, never a stored tag**: rendered in the chip vocabulary (target
  icon, "Hot · <score>"), filterable alongside tags — but derived from `score_group`
  (the pure scorer stays the single source of truth, PRN-15). No ✕, not editable,
  absent from the tag manager. If more groups ever surface (Warm/Nurture), they join
  the same presentation for free.
- **Tags are admin-only in v1** (workflow labels; partners never see them — the notes
  isolation instinct). A partner-facing tag stream is a separate future decision.
- **Tag colors from a fixed chip-safe palette**, text always present (PRN-14).
- **Search is admin-only v1**, server-side + debounced, scope-guarded; portal keeps
  its own existing search.
- **Saved views are per-user, server-persisted**, capturing the full filter state
  (incl. tag filters and list/board mode). Not shared between admins in v1.

## WP breakdown

| WP | Scope | Tier | Depends |
|----|-------|------|---------|
| WP-TAG-1 | Tags: schema + API + chips/picker/filter + Settings manager + smart-tag Hot | A | — |
| WP-SRCH-1 | Global search: endpoint + Ctrl-K overlay | A | — (parallel w/ TAG-1) |
| WP-SV-1 | Saved views: schema + API + views dropdown + save-current | A | TAG-1 merged |

Reviews: pr-reviewer + audit-tenancy each (all three add query surfaces; TAG/SV add
schema). Migration numbering: TAG-1 takes the next free (0042); SV-1 takes the one
after, sequenced by its dependency.

## TAG requirements

- **TAG-01 — Model.** `tags` (id, tenant_id, name ≤40 unique-per-tenant case-insensitive,
  color from the fixed palette enum/string, created_at) + `lead_tags` junction
  (tenant_id, lead_id, tag_id, added_by_user_id, created_at; PK or unique (lead_id,
  tag_id)). Migration + RLS (admin-only read/write within tenant) + FK-covering
  indexes + demo seed (2-3 tags on demo leads) in one PR.
- **TAG-02 — Scope.** Admin-only v1: every query tenant-scoped; the API layer gates
  admin (partner sessions 403 like sibling admin routes). RLS mirrors (two-half
  discipline per 0041 precedent: WITH CHECK pins tenant + in-tenant lead/tag refs).
- **TAG-03 — API.** Tags CRUD (create inline from picker; rename/recolor/delete in
  Settings — delete detaches everywhere, confirm-gated); attach/detach on a lead
  (idempotent); `tags` filter param (tag ids, AND/OR: v1 = OR any-of) added to the
  list AND board endpoints. Audit entries for tag create/delete/attach/detach follow
  house redaction conventions (tag names are workflow labels, not PII — stored plain).
- **TAG-04 — Chips UI.** Chips on list rows + board cards (cap 2 + "+n" on cards),
  ✕ to detach, ＋ picker with type-ahead + create-inline (name → next palette color
  round-robin, changeable in Settings). Full state matrix; tokens only.
- **TAG-05 — Smart tag Hot.** The Hot chip renders from `score_group`/`score_total`
  in the same chip row and the filter row, visually distinct (icon, no ✕), and the
  existing hot filter param is presented as a chip — zero storage, zero new endpoint.
- **TAG-06 — Settings → Tags.** Manager page: list w/ usage counts, rename, recolor
  (palette swatches), delete (confirm; shows count). Tenant-editable data (DM-08 n/a —
  tags are not rules; no snapshot needed, but note it in the module header).
- **TAG-07 — Timeline.** Attach/detach do NOT write timeline entries in v1 (noise);
  audit_log only. Recorded decision.

## SRCH requirements

- **SRCH-01 — Endpoint.** `GET /api/search?q=` admin-gated; min 2 chars; matches
  leads on seller first/last, phone (digits-normalized against phone_norm), address,
  city, ref_id (case-insensitive substring; ILIKE with bound params — through the
  scope guard, kept + non-deleted leads only... NOTE: search INCLUDES removed-MLS?
  v1: kept + removed both, with the removed badge shown — an admin searching an
  address must find the lead regardless of verdict; recalled (soft-deleted) excluded).
  Partners group: name/ref/email substring. Limit 10 per group, no pagination v1.
- **SRCH-02 — Overlay.** Ctrl/⌘-K (and a topbar trigger) from anywhere in (admin);
  400ms debounce; keyboard-complete (↑↓ ↵ esc); highlighted match fragments; lead
  rows open the lead dialog (deep-link to /leads?lead=REF per existing convention),
  partner rows to the partner page. Empty/loading/error states.
- **SRCH-03 — Purity/perf.** No new extension/dependency (boring ILIKE; a trigram
  index is a recorded candidate if volume demands); debounced keystrokes never
  re-render the page behind the overlay.
- **SRCH-04 — Security.** No PII beyond what the admin list already shows; uniform
  envelope; rate limiting inherits the app's general posture (candidate if abused).
- **SRCH-05 — Tests.** Tenant probe, admin gate, phone normalization ("(602) 555"
  finds phone_norm), ref match, removed-MLS included w/ verdict, recalled excluded,
  min-length, limit cap.

## SV requirements

- **SV-01 — Model.** `saved_views` (id, tenant_id, user_id, name ≤60, filters jsonb
  — the exact filter-state shape the leads page serializes incl. tags/hot/partner/
  status/search/view-mode, created_at, updated_at). Unique (user_id, name). Migration
  + RLS (owner-user only) + indexes + seed n/a (user data).
- **SV-02 — API.** CRUD, per-user scoped (a user sees only their own views — enforce
  user_id from scope, never client). Zod-validate the filters blob against the
  filter-state schema (unknown keys stripped — never stored blind).
- **SV-03 — UI.** Views dropdown (mockup): apply on click (replaces current filter
  state), counts optional v1 (live counts are a candidate — show none rather than
  stale), "Save current filters…" (name prompt; saving under an existing name
  overwrites after confirm), delete from the menu (confirm).
- **SV-04 — Semantics.** Applying a view REPLACES filter state; subsequent edits
  don't auto-save back (explicit re-save). The active view name shows until filters
  diverge ("modified" indicator).
- **SV-05 — Tests.** Cross-user isolation (TST-01-style), blob validation strips
  unknown keys, apply/replace round-trip, overwrite-confirm path.

## Out of scope (recorded)

Deal economics (owner-skipped) · partner-facing tags · shared/team views · tag
automation (auto-tag rules) · trigram/index tuning (candidate) · bulk tag-assign via
mass-actions (rides the future bulk-actions WP) · live view counts.
