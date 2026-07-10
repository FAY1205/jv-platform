# WS-3 — Leads — execution design

**Program:** REDESIGN-R3 · **Branch:** phase-2/distribution · **Baseline:** WS-2 head
**Authority:** `docs/backlog/REDESIGN-R3.md` §4 WS-3. Refines the locked WS-3 scope into a
concrete plan. No locked decision reopened.

Owner decisions (2026-07-10 brainstorm):
1. **F-55 deferred** — WS-3 builds the reusable, code-split `LeadDialog`, but the three
   external deep-link swaps (imports/[ref], unmatched, partners/[id]) land in **WS-4/WS-5**
   with those pages' full reworks (honors "touch each screen once"). The old
   `/leads/[ref]` page stays as a direct-URL fallback until then.
2. **StatusSelect keeps the pill** — the inline status control becomes a purpose-built
   `StatusSelect` on the WS-1 Radix `Select`, styled as the colored status pill.

## Locked inputs / bounds
- Consume WS-1 primitives: `Input`, Radix `Select`, `DateRangePicker`, `Pagination`
  (rows-per-page {10,20,50}, default 20), `RowOpenButton`, `Dialog` (replaces `Modal`),
  `Textarea`. No raw `<select>`/`<input>`/`<textarea>`/`Modal`/`NativeSelect` left on the
  reworked Leads surface (page + dialog + notes).
- Invariants: PRN-08 scope guard, PRN-12 tokens-only, PRN-13 note streams,
  PRN-14 partner name+ref+color, PRN-15 analytics single home. Effective owner =
  `coalesce(manual_partner_id, partner_id)` (already in `listLeads`).
- `matchMethodEnum = ["zip","state_fallback","none"]` (manual assignment is a separate
  boolean overlay, not an enum value).

## A. Backend — rows-per-page (Zod-whitelisted)
`src/modules/leads/schema.ts`: add `pageSize` to `LeadsQuerySchema` — whitelist to
`{10,20,50}`, default **20**, invalid → 20 (mirrors `Pagination.PAGE_SIZES`).
`src/modules/leads/queries.ts` `listLeads`: replace the hardcoded `LEADS_PAGE_SIZE = 50`
with `query.pageSize` for `limit`/`offset`; return `pageSize: query.pageSize`. Route
(`src/app/api/leads/route.ts`) already threads the schema — no change.
- *Unit test* (`leads-query-schema.test.ts`): pageSize whitelist + default.
- *Integration test* (`leads-list.test.ts`): seed >20 leads, assert `pageSize=10` returns
  10 rows with correct `total`, and page 2 offsets correctly. Requirement-ID named.

## B. Filter-bar isolation (F-54)
Extract **`LeadsFilterBar`** (memoized) that owns the raw text inputs (search,
state-abbrev) *locally* and debounces them internally (300 ms), lifting only committed
filter values to the parent via `onChange(filters)`. Extract **`LeadsTable`** consuming
only committed `{filters, page, pageSize, sort, dir, onOpen, onSort}`. `LeadsView` holds
the canonical committed filter state + `page`/`pageSize`/`sort`/`dir`/`openRef`. Typing in
search re-renders only the filter bar, not the table body. Discrete filters
(partner/source/date/status) commit immediately.

## C. Filters rebuilt on primitives (F-58)
- Search + state-abbrev → `Input`.
- Partner filter (All / Unmatched only / each partner) → Radix `Select`.
- Source filter → Radix `Select` (options from `/api/leads/sources`).
- Date range → `DateRangePicker`; its `{from,to}` maps to the existing `dateFrom`/`dateTo`
  query params.
- Status → keep accessible chip-toggles (buttons, multi-select; not a raw control).

## D. Table + rows
The existing `Table`/`THead`/`Th`/`Tr`/`Td` primitive **is** the reusable formatting
system (paddings, sticky sortable headers, `align`, accent/rail) — WS-4/5 reuse the same
primitives + conventions (text left; counts/dates right with `tabular-nums`; ref-id via
`RowOpenButton`; partner via `PartnerTag`). No new abstraction (YAGNI). Row changes:
- Ref-id cell → **`RowOpenButton`** (real `<button aria-haspopup="dialog">`, F-14). The
  row-level `onClick` is dropped (no nested-interactive row; the button is the opener).
- Status cell → **`StatusSelect`** (§E).
- Hand-rolled Prev/Next → **`Pagination`** primitive (drives `page` + `pageSize`).

## E. `StatusSelect` (new `src/components/StatusSelect.tsx`)
Radix `Select` styled as the colored status pill (per-status token classes reused from the
current `STATUS_PILL` map, moved into the component). Optimistic local value (re-seeds on
server change, ADR-0008); mutation with **`onError` → revert + toast**. Removed leads render
a read-only `Badge variant="removed"`, not a select. Props:
`{ refId, status, mlsStatus, onChanged? }`. Added to the gallery in all states.

## F. `LeadDialog` (F-56, F-57, Modal→Dialog)
- **Code-split** from `LeadsView` via `next/dynamic(() => import("./lead-dialog"), { ssr:false })` (F-56).
- **`Modal` → `Dialog`** (drop-in: same `open`/`onClose`/`title`/`size` props; focus-trap +
  return-focus now built in). `NativeSelect` (status, partner in `EditForm`) → Radix `Select`.
- **F-57:** new client-safe `src/lib/match-method.ts` — `type MatchMethod = "zip" |
  "state_fallback" | "none"` + exhaustive `MATCH_METHOD_LABEL: Record<MatchMethod,
  {label,tone}>`. `ViewMode` gains a small "Routed by" badge using it (manual assignment
  keeps its existing "Original routing" row). *Unit test:* every `matchMethodEnum` value has
  a label (exhaustiveness). Partner-profile adoption is WS-5.

## G. `NotesPanel` (F-59, F-20, a11y F-6)
Raw `<textarea>` → `Textarea` primitive; add **`onError`** to both add/edit mutations with
inline error text (context-independent — no ToastProvider dependency); wrap "Saved ✓" +
error in an **`aria-live="polite"`** region; disable the field while its save is in flight.
PRN-13 unchanged (the API scopes the single note stream by role).

## H. Out of scope / deferred (WP candidates)
- F-55 external swaps (WS-4/WS-5). Old `/leads/[ref]` page deletion (after WS-5).
- `NativeSelect`/`Modal` global deletion (end of WS-8).
- Component-level React tests (no testing-library harness in repo) — UI verified by
  typecheck + owner walkthrough.

## I. Commit sequence
1. Backend pageSize (schema + `listLeads`) + unit & integration tests.
2. `match-method.ts` (+unit test), `StatusSelect`, `NotesPanel` fixes (+ gallery).
3. `LeadDialog`: Modal→Dialog + Select + Routed-by badge + code-split.
4. `LeadsView` split into `LeadsFilterBar` + `LeadsTable` with Pagination/RowOpenButton/
   StatusSelect/Input/Select/DateRangePicker.

## Acceptance (WS-3 gate)
- Rows-per-page {10,20,50} default 20, server-enforced + Zod-whitelisted.
- No raw select/input/textarea/Modal/NativeSelect on the Leads page, dialog, or notes.
- Row open is keyboard-accessible (RowOpenButton); LeadDialog code-split; notes surface
  save errors with an aria-live region.
- Search keystrokes do not reconcile the table body (filter-bar/table memo split).
- `MatchMethod` shared type + exhaustive badge map; dialog shows "Routed by".
- `pnpm test:unit` + `pnpm test:integration` (sequential) green; `typecheck`/`lint` clean.
