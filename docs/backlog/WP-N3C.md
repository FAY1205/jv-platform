# WP-N3C: Consistency + smalls (deep-UX audit batch c) — two PRs

Spec: PRN-08/12/14/15, DSN-03, §6.17 · Tier B/S · TWO PRs (c1 = behavior/data,
c2 = chrome/copy). Source: deep-UX audit 2026-08-19; candidates C-56/C-58/C-60/C-61/
C-63/C-65/C-66/C-67/C-68/C-69/C-70 + C-48 remainder; owner answers Q3/Q5/Q9/Q10
(tracker Slice 8, "N3 kickoff decisions 2026-08-19" — all four IN scope).

All sites re-verified against main 2026-08-19 by the orchestrator; re-verify before
editing (code wins).

---

## PR c1 — behavior/data (`claude/wp-n3c1`)

### Q3 — dual lead counts + active badge (N3C-01) — audit-tenancy reviews this diff
"Active" = leads whose derived status is not "Removed MLS", i.e.
`mls_status is distinct from 'removed'` (see `statusExpr`, modules/leads/queries.ts:123-128
— the default leads view hides exactly the removed set, DEFAULT_STATUS_FILTERS,
modules/leads/schema.ts:20).
- `leadNavCounts` (modules/leads/queries.ts:681-691) gains
  `active: count(*) filter (where <not removed>)::int` in the SAME single round trip,
  composing the existing outer predicate (tenant + not-deleted). Extend `LeadNavCounts`.
  PRN-15: this is THE one server-side source; the client never re-derives it.
- Sidebar Leads badge (AppShell — find the `/api/leads/counts` consumer) switches from
  `total` to `active`. Unmatched badge unchanged.
- Leads page header (leads-view.tsx:471-483): when the status selection is the DEFAULT
  (isDefaultStatuses) and the list is unfiltered otherwise, show
  "`N` active leads · `M` total" (N = data.total of the filtered list — equals the
  active count by construction; M = counts.total from the shared ["leads","counts"]-
  family query the shell already fetches — reuse its query key/hook, do not add a
  second endpoint hit beyond the cache). With any non-default filter, keep today's
  "N leads match the filters".
- Tests: unit/integration leg on leadNavCounts named
  `N3C-01/Q3: active count excludes Removed MLS and composes tenant scope` — include a
  cross-tenant leg (counts never cross tenantWhere) since the query changes.

### Q5 — whole-row clickable tables (N3C-02)
Both tables; inner controls keep working; the existing button/link stays the keyboard
path; `cursor-pointer` only where click now works.
- Leads table (leads-view.tsx:512-513 `Tr`): row onClick → `onOpen(l.refId)` (same as
  RowOpenButton). Ignore clicks originating on interactive elements:
  `if ((e.target as HTMLElement).closest("a,button,input,label,select,[role=menuitem],[role=checkbox]")) return;`
  Also ignore when the user is selecting text (`window.getSelection()?.toString()`).
  No `tabIndex`/role on the row — it is a pointer convenience; keyboard/AT path remains
  the RowOpenButton (state this in a comment).
- Partners roster (partners/page.tsx:748-786 `Tr`): row onClick → navigate to
  `/partners/${p.id}` (router.push). Same interactive-origin guard (RowActions, the
  name Link). cursor-pointer + keep hover:bg-surface-2 (add if missing on partners rows).
- Shared: if the guard logic would be written twice, extract a tiny
  `rowClickGuard(e)` helper in src/lib (or a `clickableRow` helper on Tr) — one
  implementation.
- Test: component test `N3C-02/Q5: row click opens the lead; click on inner control
  does not double-fire` where the harness allows; otherwise document manual
  verification in the PR.

### C-60 — server task totals (N3C-03) — totals in the EXISTING response only
- `listMyTasks` (modules/tasks/tasks.ts:600-669): alongside the existing count, compute
  per-group totals + true overdue total across ALL pages of the same `where` —
  one extra aggregate in the SAME Promise.all round:
  `count(*) filter (where due_on < <today>)` / `= today` / `> today` / `is null`
  with `today = utcDateString(now)` (a date-string comparison on the DATE column,
  matching groupByDue's semantics exactly). Extend `MyTasksPage` with
  `groupTotals: Record<DueGroup, number>` (open-status calls; for status="done" return
  zeros or omit — pick one, type it honestly).
  ⚠️ groupByDue (modules/tasks/dates.ts) stays the single source for the PER-ROW bucket;
  add a drift-guard unit test: for boundary dates (yesterday/today/tomorrow/null) the
  SQL bucket condition and groupByDue agree — named
  `N3C-03/C-60: SQL group totals agree with groupByDue on boundary dates`.
- `MyTasksList.tsx`: the "N overdue" badge (:157-159) and the group headers read
  `groupTotals` from the response; per-page grouping of ROWS stays client-side and
  unchanged (:145-148). Update the page-scope comment (:135-144) — it explicitly
  deferred this WP.
- No new module, no new endpoint. Both roles hit /api/tasks — totals compose the same
  `where` (scope-safe by construction); add a cross-stream leg if cheap.

### C-56 — partners edit deep-link (N3C-04)
- Lift the roster's edit state (partners/page.tsx:632 `editing`) into `?edit=<id>`:
  on load, if `?edit=` matches a roster partner, open the edit form (seed once when
  data arrives); opening/closing edit syncs the param via router.replace (no history
  spam). The page is a client component ("use client") — if it currently reads no
  searchParams, follow the house pattern: read via a server shell prop like
  leads/page.tsx:10-20 (deliberately NOT useSearchParams+Suspense — that froze
  hydration on Next 16, see the comment there) or `window.location` seeding; pick the
  boring one consistent with the page's structure.
- Partner detail (partners/[id]/page.tsx:183-188): the "Edit on Partners →" Link →
  `href={`/partners?edit=${partner.id}`}`, relabel **"Edit partner"**.
- Admin-notes empty state (partners/[id]/page.tsx:265): "No notes yet…" gains the same
  deep-link CTA ("Add notes" → `/partners?edit=<id>`), small link styling consistent
  with siblings.

### C-69 — partner "View all in Leads →" (N3C-05)
- leads/page.tsx (server shell, :10-20) accepts `partnerId` searchParam, passes to
  LeadsView as the initial partner filter (same pattern as `hot`/`tags`).
- partners/[id]/page.tsx:272-275 "Recent leads · last N" header gains
  "View all in Leads →" Link `/leads?partnerId=<id>` (styling: the coverage "Open →"
  link precedent).

---

## PR c2 — chrome/copy/a11y (`claude/wp-n3c2`)

### Q9 — sign-out on ToS gates (N3C-06)
- Both gate screens ((admin)/tos/page.tsx, portal/tos/page.tsx) add a quiet
  "Sign out" text link/button under the card, reusing `useSignOut` (src/lib/use-sign-out.ts)
  with redirectTo "/login" (admin) / "/portal/login" (portal). Disabled/pending state
  while signing out (DSN-03).

### C-63 — auth heading + gate identity (N3C-07)
- One shared auth-card header primitive (e.g. `AuthCardHeader` in src/components or a
  local shared piece in the auth tree — smallest thing that removes the divergence):
  `<h1>` = the SCREEN'S PURPOSE (e.g. "Sign in", "Create your workspace", "Reset your
  password", "Check your email", "Terms of Service"), with the product name (APP_NAME
  from tokens — PRN-12) as a muted sibling line. Apply to login (login-form.tsx:52-55 —
  currently h1=brand), signup, forgot, reset, verify screens.
- Both ToS GATE pages rejoin the centered auth-card identity: same centered layout +
  the shared header (brand present). Keep their existing accept flow + the N3A "Read
  the full terms" link + the new Q9 sign-out link.

### Q10 / C-48 §12.1 — map caption hidden on phones (N3C-08)
- `MapCaption` (src/components/map/MapCaption.tsx:17-18): add `hidden sm:block` (or
  `max-sm:hidden`) to the plate — hides the floating title card on phones everywhere
  it renders (coverage, dashboard, portal). One-line, reversible.

### C-48 §1.2 — mobile stat-grid phantom tile (N3C-09)
- dashboard/page.tsx:224 + :239: both 3-tile `grid-cols-2 sm:grid-cols-3` grids leave
  a phantom empty cell at 2 columns — give the LAST tile `max-sm:col-span-2` so the
  odd tile spans the row. Check the portal mobile grid (portal-dashboard.tsx:158 —
  4 tiles, even, no change).

### C-58 — Admin-notes section chrome (N3C-10)
- lead-dialog.tsx:360-362 + NotesPanel.tsx:102-107: NotesPanel gains a
  `variant?: "card" | "section"` (default "card" preserves the standalone look
  elsewhere — check other NotesPanel call sites first). "section" renders the
  dialog-sibling treatment: `rounded-xl border border-border-soft bg-surface-2 p-4` +
  uppercase `text-step-1 font-semibold tracking-wide` header — match ScorePanel
  (:381-383) exactly. lead-dialog passes variant="section" (and drops its own
  border-t wrapper if redundant).

### C-65 — dialog pinned title + scroll cue + skeleton fidelity (N3C-11)
- Dialog.tsx:82-103: restructure so the title bar (and footer) sit OUTSIDE the
  scrolling region — header pinned top, footer pinned bottom, only the body scrolls.
  Preserve: FRM-02a discard overlay coverage (absolute inset-0 on Content — verify it
  still covers), bare mode, sizes, focus trap. Add a bottom edge-fade scroll cue on
  the body when scrollable (reuse the Table scrollHint recipe/tokens;
  pointer-events-none; both themes). This is the shared Dialog — eyeball every Dialog
  call site list in the PR body (lead dialogs, partner form, search palette bare mode,
  etc.) for layout regressions.
- lead-dialog.tsx:351 + :358: replace flat `h-28`/`h-24` Skeletons with panel-shaped
  skeletons — the surface-2 panel shell + uppercase header (real text "Lead score" /
  "Timeline") + inner skeleton lines, like TasksPanel's loading state.

### C-66 — truncation title + activity skeleton (N3C-12)
- MyTasksList.tsx:293-296: the seller/city span gains
  `title={`${task.leadSeller}${where ? ` · ${where}` : ""}`}`.
- activity/page.tsx:99-100: replace the 6 full-width Skeleton bars with
  column-structured skeleton table rows (a Table with THead + ~6 Tr of per-column
  Skeleton cells, mirroring the real 5-column grid).

### C-67 — upload copy + template in error card (N3C-13)
- upload/page.tsx:201: "Drop a weekly .xlsx or .csv here" (accept already includes
  .csv, :140).
- The unrecognized-format card (:161-190): add a secondary "Download template" button/
  link inside the card (reuse TEMPLATE_HREF + the download attr), next to "Choose
  another file"; adjust the ":186 Use Download template above" sentence to point at
  the in-card button.

### C-68 — active-sort emphasis (N3C-14)
- Table.tsx:127-137: when `sortDir !== null`, render the header button + arrow in
  `text-text` (or text-brand-ink — match existing emphasis conventions; check how
  aria-sort headers look elsewhere) + `font-semibold` stays. The inactive `↕` stays
  muted. Keep aria-sort as-is.

### C-70 — auth smalls (N3C-15)
- reset/page.tsx:29: confirm-password mismatch validates on blur + submit, not per
  keystroke (GOV.UK): track a `confirmTouched`/blur flag; still block submit on
  mismatch; the error clears while typing after a fix (standard pattern).
- signup/page.tsx:238-240: the `!siteKey` copy → honest persistent-state copy:
  "Signups are temporarily unavailable." tied to the disabled button (aria-describedby
  or adjacent text); drop "Please try again later" phrasing that implies a transient
  blip. (:272 disabled logic unchanged.)

---

## Out of scope (both PRs)
C-59 prev/next (N5) · C-62 assistant scrim (Q8 standing deferral) · partners sorting ·
C-61(e) coverage StatCard anatomy (owner-eyeball) · EXCLUSIONS.md C/D/E ·
anything N3a/N3b already shipped.

## Tests
tsc + lint clean; targeted vitest `--maxWorkers=4`. c1 touches modules/leads +
modules/tasks queries → run the leads/tasks integration suites against the test DB
(uoszwgbtpsqzytchvjve, `?sslmode=require` — env in .env.local). `sql\`now()\`` never
`new Date()` for DB-ordered stamps. audit-tenancy reviews the c1 diff.
