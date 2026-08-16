# WP-UX-SERIES — UX/visual audit remediation slices

Source: the 2026-08-16 screenshot-driven UX/visual audit of the running app
(report: `_marketing/ux-audit-report.html`, published as a Claude artifact; raw
captures `_marketing/audit/`; repeatable harness `_marketing/audit-capture.mjs`).
46 findings → 5 root themes → the 8 slices below. Numbers stable; tick a slice
when merged, per the WP-S3-SERIES precedent.

Rules that bind every slice:
- **OWNER 2026-08-16: mockups WAIVED for this series** — build directly; the
  MOCKUP flags below are void. (jv-leads-mockup-first still applies to future
  work outside this series.)
- **OWNER 2026-08-16: information design is first-class UX** — *which* data a
  surface shows and how it reads (columns chosen, card contents, duplicated
  facts, empty markers) matters as much as alignment/spacing. Slices should fix
  info-display issues (portal CITY/ST duplication, seller-less cards, tasks
  rows with no lead identity, em-dash farms) as part of their scope, not defer
  them as content questions.
- PRN-12: every fix consumes semantic tokens (`src/lib/tokens`, `globals.css`
  vars) — no new hex, font, or arbitrary literal.
- PRN-14: color never carries meaning alone; the map/chart fixes exist to
  *strengthen* this, don't regress it.
- FRONTEND_STANDARDS §9: admin ≥768px, portal ≥375px, no horizontal *body*
  scroll anywhere (wide content scrolls in its own container).
- Findings verified against source 2026-08-16; three were refined after code
  check (status-chip default, Coverage panel width budget, Tasks-local pager) —
  the report's inline text is the corrected record.

| Slice | Title | Theme | Sev ceiling | Mockup? | Status |
|-------|-------|-------|-------------|---------|--------|
| WP-UX-1 | Flexible table primitive + adopters | T1 | High | waived | ✅ 2026-08-16 |
| WP-UX-2 | `PageContainer` + page-width adoption | T2 | High | waived | ✅ 2026-08-16 |
| WP-UX-3 | Kanban board flexibility | T1 | High | waived | ✅ 2026-08-16 |
| WP-UX-4 | Map & chart honesty (legend/hatch/sentiment) | T4 | High | waived | ✅ 2026-08-16 (deferred: on-map choropleth labels + anchored ramp legend on Unmatched — needs state centroids; dark brand/warn chart-hue separation → UX-8) |
| WP-UX-5 | Mobile adaptivity (admin + portal) | T3 | **Critical** | waived | ✅ 2026-08-16 (admin table→card + dialog sheet deferred by recorded decision — out of ≥768px contract) |
| WP-UX-6 | Row-action & chrome hierarchy | T5 | Medium | waived | ✅ 2026-08-17 |
| WP-UX-7 | Empty-state, copy & dialog polish | T5/T6 | High | no | ✅ 2026-08-17 (deferred: scoring-card range-badge fixed width + "Required: Yes" dedup, Tags create-row colour picker, portal "My Tasks" title de-dup — small, low-risk, roll into a future polish pass) |
| WP-UX-8 | Shared paper cuts + dark parity | T6 | Medium | no | ✅ 2026-08-17 (see dark-parity note ↓) |

**WP-UX-8 dark-parity — DELIVERED vs DEFERRED.** Done: Ctrl-K duplicate-esc dedup + verified the scrim
is already present (the audit's "no scrim" was a loading-state capture); admin header search-trigger
drops its box below `md` so it sits borderless beside bell/theme (was reading "pressed"); one time-range
vocabulary across both apps (admin adopts the portal's 7d/30d/12mo/All). Verified no-ops: dotted-underline
labels already carry real tooltips (dots only render via HeaderTip when `tip` is set); mono date
"double-space" is a mono-font space-glyph perception, not padded data (`day:"numeric"`); AccountMenuTrigger
already `min-w-0`+`truncate`. **DEFERRED — mockup-first, needs the owner's eye across every surface in
dark (a global-token/shared-map change is exactly the kind the series treats as recommend-not-destabilize):**
portal `--surface`/elevation lift for dark card separation (current dark tokens are actually a sound step —
surface #17232a over bg #10181c — so this is a judgment call best made against a full-app dark mockup);
portal county-map stroke theme-parity (shared CountyCoverageMap — admin coverage regression risk);
raise dark non-territory state fill a step. These want a dedicated dark-mode pass, not a blind token edit.

---

## WP-UX-1 — Flexible table primitive + adopters  (MOCKUP-FIRST)

The systemic T1 fix. One comp of the leads table at 1280/1440/1920 settles the
width model before any code.

- `src/components/Table.tsx`: add a column-sizing vocabulary — content-sized
  columns (`w-px whitespace-nowrap`), truncating flexible cells (`min-w-0` +
  ellipsis + `title`), a density prop (comfortable/compact on `py-2.5`/`py-1.5`),
  and document the &lt;768px table→card expectation. The Unmatched table is the
  reference recipe.
- Leads list (`(admin)/leads/leads-view.tsx`): dates `whitespace-nowrap`
  (never wrap "Aug 13, 2026"); SELLER/PROPERTY flex + truncate; property as ONE
  flowing line (street + muted city run, single wrap point); consider folding
  MODIFIED (mostly "—") — owner call.
- Partners (`(admin)/partners/page.tsx`): flexible identity column, content-sized
  STATUS/COVERAGE/ACTIONS, CONTACT ellipsis+tooltip.
- Imports (`(admin)/imports/page.tsx`): FILE flexes, ROWS/STATUS/PROCESSED
  content-sized.
- Portal leads (`portal/leads/page.tsx` + dashboard Recent leads): drop the
  duplicated CITY/ST columns (address already carries them), right-size REF.
- Coverage aside (`(admin)/coverage/page.tsx`): widen the panel's page-grid
  share / tighten refId+count columns; `title` tooltip on truncated names.
  (Row internals already correct — do NOT rebuild the row.)

Acceptance: at 1440, no date/name/address wraps in the leads table with seeded
data; no dead gutter band in Imports; portal leads table has no duplicated
location columns; all tables keep sort/a11y behavior (`Table` region contract).

## WP-UX-2 — `PageContainer` + page-width adoption

- New `src/components/PageContainer.tsx`: `prose` (~720px), `wide` (~1200px),
  `full` variants; centered; spacing-scale padding. Export from `src/components`.
- Adopt: Settings layout (replace the ad-hoc `max-w-[760px]` in
  `settings/layout.tsx`), Rules (centered reading column), Team placeholder,
  Tasks (or enrich rows in WP-UX-7 — pick one), Activity results region
  (`min-h-[60vh]`, centered EmptyState).
- One comp of Rules + Settings inside the container for sign-off (light mockup).

Acceptance: Settings/Rules/Imports/Tasks share consistent right edges; the
Password card's label→button distance collapses; no page reads as floating.

## WP-UX-3 — Kanban board flexibility  (MOCKUP-FIRST)

- Columns flex `minmax(240px,1fr)` (flex context — grid idiom is fine here) so
  6–7 fit at 1440; persistent thin scrollbar + right-edge fade scrim (`scrim`
  token) when columns overflow; consider collapsed vertical headers for
  empty/terminal columns.
- Columns fill viewport height (`flex-1 min-h-0`, per-column `overflow-y:auto`)
  with an in-column count footer ("3 of 43 — scroll"); virtualize card lists
  (standards §6.17 >200 rows) — measure first, KAN-10 memoization must hold.
- Filter parity: same filter-bar instance in List and Board (KAN-09 widened);
  one row, not three.
- Card: tag "+" ghost only on hover/focus; chips render at rest (TAG-04 cap
  stays); target ≤4-line card.
- Dark: `border-soft` hairline on cards, `border-strong` dashed affordances.
- File: `(admin)/leads/leads-board.tsx` (+ `leads-view.tsx` filter bar).

Acceptance: all 7 statuses reachable/visible at 1440 (or explicitly collapsed);
no silent truncation — every column states its total vs shown; drag + ⋯ menu
(KAN-05) unchanged; board still renders under the KAN-10 re-render discipline.

## WP-UX-4 — Map & chart honesty

- Dashboard map: add the "Uncovered" legend (reuse Coverage's swatch row);
  neutralize the hatch stroke (`border`/`surface-3`) in `MapHatch.tsx` /
  `CountyCoverageMap.tsx` — one change, both maps. **Top single item: the only
  finding where a viewer draws a wrong conclusion.**
- KPI deltas (`Stat.tsx`/`HeroKpi.tsx`): per-metric polarity map →
  `success`/`danger` ink; "· same" → "no change"/"—" (kills the dangling middot
  everywhere, admin + portal).
- Donut (`DonutChart.tsx`): legend rows in slice order; hover slice↔row
  emphasis; separate the three amber-family slices via distant chart tokens.
- Lead Flow (`LineChart.tsx`): unmatched series on `danger`; legend beside the
  chart header.
- Unmatched choropleth: direct labels on the ≤6 gap states ("NE · 7"); anchored
  min/max legend.
- `MapOverlay` primitive owning safe-area insets + narrow-width docking (fixes
  the clipped zoom control, the occluded −, the mobile chip-over-map).

Acceptance: dashboard map has a legend; hatch ≠ brand family; no delta middot
anywhere; PRN-14 satisfied *on the visualizations themselves*.

## WP-UX-5 — Mobile adaptivity  (MOCKUP-FIRST for the card lists)

Admin (target ≥768px — these are graceful-degradation, except S-1 which is the
audit's Critical):
- **Settings nav → horizontal pill strip / Select below `md`**
  (`settings/layout.tsx`, `settings-nav.tsx`). The Critical.
- Stat grids `auto-fit/minmax` → 2-across &lt;480px (dashboard + coverage).
- Dashboard performance tables: `overflow-x-auto` + edge fade, or 2-column
  collapse (standards: wide content scrolls in its own container).
- ~~Leads table &lt;`md` card list~~ / ~~lead dialog full-height sheet~~ —
  **DECISION (WP-UX-5, 2026-08-16): deferred as out of contract.** FRONTEND_STANDARDS
  §9 commits the admin app to ≥768px; phones get graceful degradation (which the
  clipped-table scrollHint + stat-grid reflow + settings pill-nav now provide), not a
  parallel phone UI. Revisit only if the admin viewport contract changes — then the
  board card is ~90% of the needed card-list component.

Portal (375px is contractual):
- Restore search `Input` + status chips (horizontal scroll row) on mobile leads.
- Seller name = the card's primary bold line.
- Chevron affordance on cards; confirm tap→sheet surfaces the status control.

Acceptance: settings content above the fold at 390px; no clipped-mid-header
table anywhere; a partner can find a lead by name on a phone; portal card shows
the person to call.

## WP-UX-6 — Row-action & chrome hierarchy

- Unmatched: row Assign → secondary/outline (fill on row hover); bulk "Assign
  selected" bar for the existing checkboxes; WAITING value tinted `warn`/`danger`
  past thresholds (with the number — PRN-14).
- Leads list + board: tag "+" on hover only (shared with WP-UX-3's card change —
  land the `LeadTags` affordance once).
- Partners: fixed-slot action cluster or ⋯ overflow menu (destructive `danger`
  inside the menu).
- Saved views: delete icon ghost until row hover.
- Tag picker: normalize the heavy double focus ring to the global
  `focus-visible` treatment.
- Status filter → multi-select picker (OWNER DIRECTION 2026-08-16): replace the
  7-chip row with a TagPicker-style multi-select whose trigger summarizes state
  ("Status: All active" / "Status: New + Contacted" / "Status: 2 of 7"), with
  deviations-from-default rendered as removable ✕-chips in the chip row — the
  exact grammar the tag filter already uses. Hot stays a standalone chip
  (binary, one-click); the board keeps NO status control (columns express it).
  Kills the amber-wall default at the root + fixes the mobile 3-row chip wrap.
  MOCKUP-FIRST (this is the slice's one comp). FilterPill's states are correct —
  the primitive is untouched; the portal's status chip row should follow the
  same pattern in the same pass for parity.

## WP-UX-7 — Empty-state, copy & dialog polish

- Activity (`(admin)/activity/page.tsx:93`): split unfiltered ("No activity
  recorded yet" + what gets logged) vs filtered ("Nothing matches" + Clear
  filters button); add a filter-bar Reset; `min-h` + centered EmptyState.
- Rules: move the phrases lock-chip into the MLS-phrases card; empty-phrases
  copy states the consequence ("no leads are being filtered as already-listed");
  "Required: Yes" once above the table, annotate only the Mortgage exception;
  fixed-width badge slot so ranges align.
- Lead dialog: demote em-dash empties ("Not provided" / collapse optional
  pairs / inline Add for phone+email); unify section-header style (one caps
  treatment; amber = links/actions only); bottom fade scroll cue.
- Tasks: enrich rows with lead name/address + partner chip (the data exists on
  the platform — mock one row first); date pill drops the group-word inside
  grouped sections ("Overdue · Aug 7" → "Aug 7"); titles wrap 2 lines &lt;`md`;
  pager only when `totalPages > 1` (`MyTasksList.tsx:195`).
- Portal Tasks/Activity: shared `EmptyState` with icon + "Go to Leads →"
  `LinkCard` CTA; drop the duplicated "My Tasks" title.
- Imports: mute the 52× "processed" pill to text; pill reserved for
  failed/needs-review (ING-08 keeps failures loud).
- Team nav: "Soon" pill (`surface-3`/`text-3`) or hide until it ships.
- Tags settings: 6-swatch picker on the create row; ACTIONS header aligned to
  its icons; verify the delete-confirm modal states "removes from N leads".

## WP-UX-8 — Shared paper cuts + dark parity

- Ctrl-K: `scrim` behind the palette; drop the in-input esc chip (footer hint
  stays). Re-capture the results state (the audit caught only loading).
- Dotted-underline policy: real definitions only; plain smallcaps otherwise
  (admin + portal stat labels).
- Mono date padding: keep pad-alignment in table columns; drop inside pills
  ("Overdue · Aug␣␣7").
- Header icons: `IconButton` quiet variant for all three admin topbar icons.
- Time-range vocabulary: one of "7d/30d/12mo" vs "7 days/…" across both apps.
- Dark: portal `--surface` one step above `--bg` (or dark-tuned `elevation.sm`);
  portal map county-stroke driven by a theme-pair token (dark shows strokes,
  light doesn't — the two themes draw different maps; likely stroke==fill in
  light); raise non-territory state fill a step so the US silhouette survives.
- Account chip truncation threshold (portal sidebar truncates with slack left).

---

**Deliberately NOT in any slice** (audit stance: recommend only, owner decides):
column show/hide + drag-reorder/resize (stage 2/3 of the flexibility ladder —
revisit after WP-UX-1 lands, most of the perceived rigidity should be gone);
per-tenant theming; board on mobile beyond wayfinding.

**Capture-rig follow-ups** (not product work): seed audit events so Activity
can be re-audited with data; settle-wait for Ctrl-K results before the shot.
