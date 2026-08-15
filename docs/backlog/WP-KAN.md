# WP-KAN-1: Leads kanban board (CRM slice 2)

Spec: KAN-01..10 (below) · Phase: CRM-2 · Depends: nothing (slice 1 merged) ·
Mockup: approved 2026-08-15 (artifact 6b01ee9c) · Tier A (new query surface) ·
Model: Opus 4.8 implement · Review: pr-reviewer + audit-tenancy

## Owner decisions locked at mockup sign-off

- Fixed six columns in workflow order (New → Contacted → Appointment → Under contract
  → Closed → Dead); Closed/Dead fully visible, drag-in allowed. Editable stages remain
  a deferred polish (data-only when wanted — status column is already text, SEAM-06).
- Stale threshold fixed at 14 days (amber label + ⚠, never color alone). A per-tenant
  setting is a future candidate, not v1.
- Admin-only v1. The portal keeps its list.
- Hand-rolled drag (HTML5 DnD / pointer events) — NO new dependency, per house
  precedent (map pan/zoom, RadioGroup). The keyboard "Move to…" menu is the a11y path
  and ships in the same WP, not later.

## Requirements

- **KAN-01 — View toggle.** The admin Leads page gains a List/Board segmented toggle.
  Choice persists in the existing small UI-preferences store (never server data).
- **KAN-02 — Board read endpoint.** `GET /api/leads/board` (admin-gated like sibling
  admin endpoints): per-status columns over the six seeded statuses; kept
  (`mls_status='kept'`), non-deleted leads only; scope via `leadWhere`; current status
  via the existing correlated latest-status subquery (reuse, don't re-derive — PRN-15).
  Per column: true total count + the first page of cards (PAGE_SIZE 25), ordered by
  last status-change (fallback created_at) desc. `?status=X&page=N` loads more for one
  column. Zod on params; uniform envelope.
- **KAN-03 — Card payload.** refId, seller first+last, city/state, effective partner
  {name, refId, color} or null (render "Unmatched" warn text — KAN-08), hot flag +
  score total, `statusSince` (ISO of latest status row, else lead createdAt).
  Days-in-status and the stale flag are computed from `statusSince` vs an injected
  "now" in ONE pure client fn (`boardAge(statusSince, now)`) — no Date.now() in module
  logic; `STALE_DAYS = 14` exported constant.
- **KAN-04 — Drag = append.** Dropping a card on another column calls the EXISTING
  `POST /api/leads/{ref}/status` (idempotent, appends history, fires the existing
  notification path). Optimistic move + rollback + toast on failure. Dropping on the
  same column is a no-op (no request).
- **KAN-05 — Keyboard path.** Every card has a ⋯ menu with "Move to…" listing the
  other five statuses (same endpoint). Menu is fully keyboard operable; drag is never
  the only way.
- **KAN-06 — Click-through.** Clicking a card opens the existing lead dialog
  (drag vs click disambiguated by a small pointer-movement threshold).
- **KAN-07 — No new deps.** Native DnD/pointer events only.
- **KAN-08 — Exclusions.** Removed-MLS leads never appear on the board; recalled
  (soft-deleted) leads never appear; unmatched leads appear with the warn label.
- **KAN-09 — Filters carry over.** The board honors the same partner filter and
  hot-only filter the list view offers (as board-endpoint params). Other list filters
  may be deferred — state which in the summary.
- **KAN-10 — Perf discipline.** Per-column server pagination (25); moving one card
  must not re-render every column (memoize columns; state per §6.17); board fetch is
  one request, load-more is per-column.

## Definition of done

- [ ] Endpoint + Zod + tests: admin-gated (partner scope → 403/redirect per sibling
      convention), tenant-scoped (TST-01-style probe), latest-status correctness
      (a lead with multiple history rows lands in the LATEST column), pagination
      (26 leads in one status → 25 + load-more with true count), removed/recalled
      exclusion, unmatched payload shape.
- [ ] Pure `boardAge` unit tests (fresh/stale boundary at exactly 14d, injected now).
- [ ] Board UI from src/components primitives; full DSN-03 state matrix incl. the
      drag states (dragging card, valid drop target) and loading/empty/error per
      column; PRN-12 tokens only; PRN-14 labels-with-color.
- [ ] Component tests: render, optimistic move + rollback, same-column no-op,
      move-menu path, click-vs-drag threshold.
- [ ] View-toggle preference persists via the existing UI store.
- [ ] Full unit suite + (endpoint touches shared query layer? if any shared module is
      touched → full integration suite) + tsc/eslint clean on touched files.

## Out of scope

Portal board · editable stages · per-tenant stale setting · deal-economics fields
(offer value / close date / lost reason — likely the NEXT slice; a "Dead requires a
lost reason" prompt belongs there, not here) · WIP limits · swimlanes.
