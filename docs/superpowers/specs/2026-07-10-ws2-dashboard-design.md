# WS-2 — Dashboard — execution design

**Program:** REDESIGN-R3 · **Branch:** phase-2/distribution · **Baseline:** WS-1 head
**Authority:** `docs/backlog/REDESIGN-R3.md` §4 WS-2 + D5. Refines the locked WS-2
scope into a concrete plan. No locked decision reopened.

Owner decisions in the 2026-07-10 brainstorm:
1. **New rolling-window range module**; the calendar-period path is retired from the
   dashboard and left for WS-9's scheduled dead-code removal (no churn now).
2. **KPI band = 5 cards**: Leads in · Distributed · Removed·MLS · Unmatched · **Closed**
   (drop "Volume covered"). All range-bounded, each with a delta vs the prior window.
3. **True SQL aggregation** for every dashboard number (per audit F-10 "push aggregation
   into SQL"), including the partner table's derived facts — not range-bounded hydration.

## Locked inputs / bounds
- Time filters: **Last 7 days / Last 30 days / Last 12 months / All time**. Bucket
  granularity 7d/30d → daily, 12mo/all → monthly. "vs prior period" = the immediately
  preceding equal-length window; `all` has no prior (deltas null).
- D5 **Delivered → Distributed** lands here (UI + digests + notifications + run-summary
  text + Excel export sheet text + tests).
- Consume WS-1 primitives: Radix `Select`, `LineChart`, `DonutChart`, `Tooltip`.
  `DateRangePicker` not used (ranges are fixed presets); `Pagination`/virtualization not
  used (partner/source tables are small, ≤ partner/campaign count); `apiMutate` N/A
  (dashboard is read-only).
- Invariants: PRN-08 scope guard, PRN-12 tokens-only, PRN-14 never color alone,
  PRN-15 analytics is the single home. Effective owner = `coalesce(manual_partner_id,
  partner_id)` (WS-0 rule) defines "Distributed".

## A. `ranges.ts` — pure range math + formatters (new)
`src/modules/analytics/ranges.ts`:
- `type RangeKey = "7d" | "30d" | "12mo" | "all"`; `type Bucket = "day" | "month"`.
- `interface RangeWindow { start: Date; end: Date; prevStart: Date | null;
  prevEnd: Date | null; bucket: Bucket }`.
- `rangeWindow(key: RangeKey, now: Date): RangeWindow` — `now` injected, never read.
  - `7d`: `start = now − 7d`, `end = now`, prev = `[now−14d, now−7d)`, bucket `day`.
  - `30d`: `start = now − 30d`, prev = `[now−60d, now−30d)`, bucket `day`.
  - `12mo`: `start = now − 12 months` (UTC month arithmetic), prev = preceding 12 months,
    bucket `month`.
  - `all`: `start = epoch`, `end = now`, prev = `null`, bucket `month`.
- `formatContactTime(hours: number | null): string` — `—` when null, `Xh` under 48h,
  else `Xd` (1 decimal). The single formatter for Avg Contact.
- `AVG_CONTACT_DEFINITION: string` — the human sentence for the info tooltip (single home).
- `delta(cur, prev: number | null): number | null` helper.
- Unit tests (`ranges.test.ts`): window math for each key incl. month arithmetic and
  the `all`→no-prior case; `formatContactTime` boundaries. Requirement-ID names.

## B. Backend — SQL aggregation bounded by range (F-10, PRN-15)
`dashboardData(scope, range)` rewritten in `analytics/queries.ts` (drops the whole-table
hydration + the `periodRange`/`buildPeriodSummary`/`bucketByWeek`/`partnerPerformance`/
`sourcePerformance` in-Node path for this function). Every query is tenant-scoped through
the guard (PRN-08) and bounded to `[start,end)` (and the prior window) at the SQL layer,
following the `coverage/queries.ts` aggregation style. Returns:

```
interface DashboardData {
  range: { key: RangeKey; start: string; end: string; bucket: Bucket };
  stats: {                       // each: current-window count + delta vs prior (null on all)
    leadsIn:     { value: number; delta: number | null };
    distributed: { value: number; delta: number | null };
    removed:     { value: number; delta: number | null };
    unmatched:   { value: number; delta: number | null };
    closed:      { value: number; delta: number | null };
  };
  trend: { bucketStart: string; leadsIn: number; distributed: number; unmatched: number }[];
  partners: { partnerId; name; refId; color; given; untouched; contacted;
              closed; avgContactHours: number | null }[];
  sources:  { campaign; imported; removed; closed; removalRate }[];
}
```

Definitions (SQL, single home):
- **Leads in** = leads with `created_at ∈ range`, not `deleted_at`.
- **Distributed** = those AND `mls_status='kept'` AND
  `coalesce(manual_partner_id, partner_id) IS NOT NULL`.
- **Unmatched** = kept AND effective owner `IS NULL`.
- **Removed·MLS** = `mls_status='removed'` in range.
- **Closed** = leads whose latest status is `Closed` reached via a `lead_status_history`
  row with `created_at ∈ range` (event-scoped, matches current semantics).
- **Trend** = `generate_series(start, end, bucket)` LEFT JOIN `date_trunc(bucket,
  created_at)` counts → zero-filled buckets.
- **Partner table** — a CTE derives per-lead `first_touch_at` (earliest history row with
  status ≠ default), `closed_at` (latest `Closed` history row), and `current_status`;
  aggregated per effective partner over kept leads: `given` (received in range),
  `untouched` (given AND current status = default `New`), `contacted` (first-touch in
  range), `closed` (closed in range), `avgContactHours = AVG(first_touch − received)` over
  contacted leads. Sorted by given desc, then contacted desc, then partnerId.
- **Source table** — per `coalesce(nullif(trim(campaign),''),'Unattributed')`: imported +
  removed (received in range), closed (closed in range), removalRate. Donut = removed per
  source (built client-side from `sources`).

The API route `/api/dashboard` swaps `?period=` → `?range=`, **Zod-validated** (enum,
defaults to `30d` on invalid). Uniform error envelope unchanged.

Integration tests (`tests/integration/dashboard.test.ts`) against the dev DB seed a small
fixture and assert: range bounding (a lead outside the window is excluded), Distributed
uses the effective owner (a re-routed lead counts for the manual partner, not the pipeline
one — ties to WS-0 F-01), delta vs prior window, trend zero-fill, Avg Contact excludes
untouched leads, Closed is event-scoped. Requirement-ID names (ANA-01/02/03, F-10).

## C. Avg Contact — single source + tooltip (ANA-03 / F-64)
The SQL `AVG(first_touch − received)` expression is the sole computation; `formatContactTime`
is the sole formatter; `AVG_CONTACT_DEFINITION` is the sole human sentence, rendered in a
`Tooltip` info icon on the column header. Info tooltips also added to the other computed
KPI/column headers on the page (Distributed, Unmatched, Removed, Untouched, Contacted).

## D. Frontend — `dashboard/page.tsx` rebuilt on WS-1 primitives
- **Range filter**: WS-1 Radix `Select` — options Last 7 days / 30 days / 12 months /
  All time; drives `queryKey: ["dashboard", range]`.
- **KPI band**: 5 cards (Leads in · Distributed · Removed·MLS · Unmatched · Closed), each
  with a delta chip vs prior window (`—`/"all time" on `all`). Reuse the existing `Stat`
  visual; tone by semantic token only (PRN-12).
- **Trend**: Recharts `LineChart`, 3 named series (Leads in / Distributed / Unmatched);
  PRN-14 — every series named in legend + tooltip, never color alone.
- **Partner performance table**: progress bars removed; numeric columns right-aligned,
  tabular numerals, normalized spacing; header info tooltips; `PartnerTag` keeps
  name+refID+color (PRN-14).
- **Lead source performance**: table (source · imported · removed · removal % · closed)
  + `DonutChart` of removed per source (center total, labeled legend with counts+%).
- **Alert banner (F-21)**: destructure `error` on the `/api/coverage` query; render an
  explicit error item ("Couldn't check attention items — retry") instead of a masked
  "all clear." Main dashboard query keeps loading/error/empty/success branches.
- Every state present (loading skeleton, error, empty, success) per FRONTEND_STANDARDS §8.

## E. D5 rename — Delivered → Distributed
User-facing text changed + asserting tests updated in the same commit:
- `dashboard/page.tsx` — rebuilt, uses "Distributed" natively.
- `modules/notify/outbox.ts:200` — digest email body "… distributed · … removed · …".
- `modules/notify/digests.ts` — the "Delivered (kept)" digest label → "Distributed (kept)".
- `modules/export/render.ts:207` — Run_Summary sheet header `["Partner","Distributed"]`.
- `modules/notify/prefs.ts:27` — pref label "New leads distributed to you".
- `app/imports/[ref]/page.tsx` — the `Stat label="Delivered"` and "delivered" caption text
  (text only; full rework is WS-4).
- `app/partners/[id]/page.tsx` — `Stat label="Leads delivered"` + "No leads delivered…"
  empty state (text only; full rework is WS-5).
- Tests: `tests/unit/digests.test.ts`, `tests/unit/run-summary.test.ts`, and any export
  text assertion updated to the new strings.
- **Left unchanged**: internal field identifiers in the retiring `periods.ts`/`overview.ts`
  (WS-9 removes them); `settings/notifications` "how each alert is delivered" (that is
  email-delivery, a different sense).

## F. Commit sequence (small commits; relevant suites green before each)
1. **D5 rename** — non-dashboard text surfaces + their tests (isolated, low-risk).
2. **`ranges.ts`** + unit tests.
3. **SQL `dashboardData`** rewrite + Zod route (`period`→`range`) + integration tests.
4. **Dashboard UI rebuild** on primitives + Recharts (uses "Distributed" natively).

## Acceptance (WS-2 gate)
- Dashboard filters are the 4 rolling windows; chart + stat cards + partner table + source
  table all obey the selected range; deltas compare the prior equal window.
- Every dashboard number is aggregated in SQL bounded by range (no whole-table hydration
  in `dashboardData`).
- Avg Contact defined once in `src/modules/analytics`, formatted once, with a header
  tooltip; Distributed uses the effective owner.
- Page uses only WS-1 primitives (no raw selects/inputs/modals); token contrast preserved.
- D5 rename complete across UI + digests + notifications + run-summary + export text, with
  updated tests. No "Delivered" (lead sense) left in user-facing text.
- `pnpm check` green; unit + integration suites green against the dev DB.

## Out of scope (WP candidates)
- Removing the now-dead calendar-period `analyticsOverview`/`periodSummary`/`periods.ts`
  helpers (WS-9 dead-code removal).
- Partner/source table pagination (not needed at current cardinality).
- Custom (arbitrary) date ranges on the dashboard (fixed presets only per spec).
