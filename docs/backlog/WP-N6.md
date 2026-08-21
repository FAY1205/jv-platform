# WP-N6 — Leads power tools

Owner decisions 2026-08-21 (tracker Slice 8, PR #166) + mockup sign-off 2026-08-21
([artifact rev-1](https://claude.ai/code/artifact/8de91d2e-c0df-4eba-968c-bb29bd93603f), approved
as shown; A1 = full transfer with TWO-STEP confirmation; A2–A5 defaults accepted).
Spec sections binding this WP: §3 (PRN-01/04/05/08/12/13/14/15), §6.4 (ASN), §6.6 (EXP),
§6.10 (NTF), §6.16 (API), §6.17 (FEP), §6.19 (SEC-05/06), §6.23 (TAG), §6.24 (SRCH),
§6.25 (SV), §9 (TST). Candidate numbering starts at **C-139**.

## 0. Scope (owner-pinned)

1. **Selection = page + escalate.** Row/page checkboxes on the admin leads LIST; with the
   filtered total above the page's selection, a banner offers "Select all N matching this
   filter" — escalated actions run SERVER-SIDE against the validated filter, never an id list.
2. **Actions v1 = all four:** change status · add/remove tags · assign to partner
   (two-step: destination pick → server-resolved count confirm; PRN-05 per lead — ineligible
   leads skipped and reported) · export selected (fixed EXP-02 contract + SEC-06).
3. **Bulk assign notify = ONE summary per partner per run** (single assigns unchanged; email
   legs follow the existing per-user prefs). A bulk run has one destination partner, so this is
   the existing `notifyLeadsBulkAssigned` rollup reused from the new path.
4. **Ctrl-K v1 = navigate + views only** (jump to pages, apply saved view, clear filters, open
   Columns; NO mutations from the palette). **Update-view** (overwrite the applied saved view
   with current filters, guarded confirm) is in-slice.

Signed-off defaults (all reversible): **A2** bulk status emits NO notifications (admin
single-status precedent). **A3** export-selected keeps the fixed 18-column contract — no tags
column; a `Selection_Summary` sheet replaces `Run_Summary`; direct download, nothing stored.
**A4** no artificial ceiling on escalated runs (the server-resolved confirm count is the guard;
the 200-ref cap stays on the checkbox path). **A5** selection survives paging, clears on filter
change (Unmatched-page contract).

**Out of scope (deliberate):** palette mutations · bulk delete/void · portal-side selection ·
tags column in exports · board-view selection (list only, v1) · virtualization changes.

## 1. Shared selection contract (PR A)

- **N6-01** One Zod contract `BulkSelectionSchema` in `src/modules/leads/schema.ts`:
  discriminated union
  `{ mode: "refs", leadRefs: string[] }` (1..200, each `/^LD-\d{2}-\d{5,}$/` — the existing
  assign-bulk bound) `| { mode: "filter", filters: BulkFilterSchema }`.
- **N6-02** `BulkFilterSchema` covers the same nine fields the saved-view blob picks
  (`q, partnerId, state, source, statuses, hot, tags, dateFrom, dateTo`) but is **STRICT for
  writes**: unknown keys and malformed values → 400 `invalid_filters`, never degrade. This is a
  deliberate, documented divergence from the leads LIST contract (reads degrade to defaults;
  a degraded WRITE filter would silently widen the blast radius). Mutation-verify: a test feeds
  a corrupted `statuses` value and asserts 400 + zero writes.
- **N6-03** Server predicate: extract `listLeads`' condition builder
  (`queries.ts` ~140–164) into a shared `leadsFilterConds(scope, filters)` consumed by BOTH
  `listLeads` and every bulk resolver — one definition of "matching" (PRN-15 instinct). The
  extraction is behavior-preserving; the existing leads-list suites must pass unmodified.
- **N6-04** Every bulk endpoint: `assertCsrf(request, { requireToken: true })` +
  `getServerScope()` + capability gate + `requireTosResponse` (new endpoints take the ToS gate —
  the tag-route precedent; the legacy assign-bulk gap is C-candidate material, not silently
  copied). Admin stream only; Zod-validated; uniform error envelope.
- **N6-05** **Dry-run leg.** Each mutation endpoint accepts `dryRun: true` → resolves
  eligibility server-side and returns `{ total, eligible, skipped: { reason: count } }` with
  ZERO writes (test-pinned: dry-run performs no INSERT/UPDATE/DELETE and writes no audit row).
  The confirm dialogs render dry-run numbers — the dialog's count is the server's count, both
  modes (the mockup's honesty rule).
- **N6-06** Execute responses return the true split:
  `{ total, applied: n, skipped: { reason: count }, skippedRefs: { ref: string; reason:
  BulkSkipReason }[] }` with `skippedRefs` bounded (first `BULK_SKIPPED_REFS_MAX = 500`, plus
  exact counts) — nothing silent. *(Amended during PR A review: the element carries its REASON,
  not a bare ref. N6-55 requires the skipped dialog to group by reason, and a flat `string[]`
  cannot be grouped client-side without a second round trip. The field name, the bound and the
  "counts are always exact" contract are unchanged; the per-reason counts remain the
  authoritative tally when the cap bites.)*

## 2. Bulk assign (PR A)

- **N6-10** Semantics = **full transfer** (owner A1), generalizing `bulkAssignLeads`:
  eligible = kept (`mls_status='kept'`), not soft-deleted, effective owner
  (`manual_partner_id ?? partner_id`) ≠ destination. Skip + report: `removedMls`,
  `alreadyAssigned` (already at destination). The write sets ONLY the manual overlay
  (`manualPartnerId`, `manualAssignedAt`, `manualAssignedBy`) — `leads.partner_id` /
  `match_method` are never touched (PRN-05; assert before/after in tests).
- **N6-11** Destination resolved server-side inside the transaction under
  `tenantWhere(partners)` + `ne(status,'revoked')` + `isNull(deletedAt)` →
  `InvalidAssignTargetError` otherwise. The response's `assignedPartnerId` is server-resolved
  (PRN-08a) and is the ONLY value the notify fan-out may address.
- **N6-12** Filter mode resolves eligible leads inside the transaction from
  `leadsFilterConds` + eligibility predicates; the UPDATE is set-based with `RETURNING ref_id`
  (no client id list, no JS materialization before the write). Refs mode keeps the existing
  inArray shape.
- **N6-13** Audit: one `audit_log` row per assigned lead, `action: "lead.manually_assigned"`,
  `after` carries `{ bulk: true }` — the existing shape, unchanged.
- **N6-14** **Two-step UI flow (owner A1):** step 1 — "Assign…" opens the destination picker
  (active partners, name + refId, PRN-14); step 2 — confirm dialog renders the dry-run split
  (selected / will be assigned / skipped by reason), the destination as "Name (REF)", and the
  transfer-consequence copy (verbatim register of the N5 single-lead `transferCopy`
  consequence); the danger-variant confirm button names the eligible count
  ("Assign 641 leads"). Esc/Cancel at either step abandons cleanly.
- **N6-15** Notify after commit, best-effort, outside the transaction (the events.ts
  contract): eligible count > 1 → `notifyLeadsBulkAssigned({ partnerId, count })` (ONE summary
  per run — one destination per run makes this one-per-partner by construction); count == 1 →
  `notifyLeadAssigned` with the per-lead deep link (existing route precedent). Zero
  eligible → no emit.

## 3. Bulk status (PR A)

- **N6-20** `status` validated at the boundary via `z.enum(SEED_LEAD_STATUSES)` (the admin
  route precedent — never a bare string).
- **N6-21** Eligible = kept + not soft-deleted + **current derived status ≠ target** — the
  set-based mirror of `updateLeadStatus`' idempotency (`changed:false` never writes a duplicate
  history row). "Current" uses the ADMIN derivation (unscoped latest per lead:
  `created_at desc, id desc limit 1` — the `statusExpr` semantics). Removed-MLS leads are
  skipped + reported (`removedMls`), the PRN-04-adjacent `LeadRemovedError` rule; leads already
  at the target are reported as `alreadyAtStatus`, not written.
- **N6-22** Write = one set-based `INSERT INTO lead_status_history (tenant_id, lead_id,
  status, changed_by_user_id) SELECT …` over the eligible set inside one transaction.
  Assignment columns untouched (PRN-05 trivially).
- **N6-23** **No notifications** (owner A2) — matching the admin single-lead status route,
  which deliberately emits nothing; the portal path is untouched.

## 4. Bulk tags (PR A)

- **N6-30** One endpoint, `op: "add" | "remove"` + `tagId` (uuid) + selection. Tag resolved
  under `tagWhere(scope)` first → 404 outside the tenant.
- **N6-31** Add = set-based `INSERT … SELECT` over the selection with `onConflictDoNothing`
  on `(lead_id, tag_id)`; remove = set-based DELETE. Both report
  `{ applied, skipped: { alreadyTagged | notTagged: n } }` derived from the row counts.
  Selected leads of any MLS status are taggable (matches per-lead attach, which never gated on
  status). `added_by_user_id` = actor.
- **N6-32** Audit volume: ONE summary `audit_log` row per run —
  `lead.tags_bulk` with `{ op, tagId, count }` — the `deleteTag` `{ detached: count }`
  precedent, NOT one row per lead (deliberate divergence from single attach; documented at the
  write site).
- **N6-33** UI: the Tags popover-dialog with an Add | Remove segmented control and the
  existing roster (bounded `{tags,total,limit}` contract; TAG-05's smart "Hot" is absent —
  it is not a stored tag). No tag creation from the bulk surface (create stays in the picker /
  Settings; the TAG_LIMIT advisory-lock path is untouched).

## 5. Export selected (PR B)

- **N6-40** `POST /api/leads/export` — POST because the body carries the selection; gates:
  CSRF + `data.export` + ToS. Accepts `BulkSelectionSchema` (both modes; A4 = no cap on the
  filter mode).
- **N6-41** Output = the fixed EXP-02 18-column workbook via the existing `renderExport`
  serializer chain (`toExportLead` — the single serializer, R-11): grouped by partner with the
  deterministic order, `JV_Color_Legend`, color-coding per the workspace setting (SET-01),
  `blankCampaign: false` (admin surface, run-export parity). NO new columns (owner A3); tags
  never enter the sheet.
- **N6-42** `Selection_Summary` sheet replaces `Run_Summary`: filter description (or
  "N selected by hand"), total exported, per-partner counts, exported-by (user email) +
  timestamp. The renderer stays PURE (PRN-01) — who/when/filter-words are computed in the
  route and passed in as data. SEC-06: every cell in the new sheet that can carry
  user-originated text (filter q, tag names in the filter description, emails) goes through
  `sanitizeCell` — export it from `render.ts` (it is module-private today; the tags module
  header explicitly demands this for any future tag-bearing cell).
- **N6-43** Sync generation, direct download (`Content-Disposition: attachment`,
  `Cache-Control: no-store`), nothing stored in Storage — the portal-export shape. Filename
  `leads-selection-YYYY-MM-DD.xlsx` (route-side date).
- **N6-44** Tenant/PII legs: filter-mode export resolves through `leadsFilterConds` under the
  same scope helpers; a TST-01d-style suite proves a same-user-other-tenant row can never be
  exported (tenant leg load-bearing, mutation-verified).

## 6. Selection UI (PR A)

- **N6-50** State lives in `LeadsBody`: `selected: ReadonlySet<string>` (refIds) +
  `allMatching: boolean`. Escalated mode carries NO id list — actions serialize the committed
  `filters` into the `mode:"filter"` arm (same values the list query serializes).
- **N6-51** Reset contract (owner A5): selection survives paging; any `filterKey` change
  (filters OR sort/dir) clears both `selected` and `allMatching` — the render-time compare the
  page already uses for `page` (Unmatched parity). Touching any row/page checkbox while
  escalated drops back to page mode with that checkbox applied.
- **N6-52** Checkbox column: always present for seats that can act
  (`leads.write` OR `data.export`); absent entirely for read-only tiers. Header checkbox is
  tri-state — `Checkbox` gains an optional `indeterminate` (Radix `checked="indeterminate"`)
  arm; hit-target via the existing `CHECKBOX_HIT_AREA`. Row checkboxes are ignored by the
  row-open handler by construction (`rowClickGuard` already defers to `[role=checkbox]`).
- **N6-53** Action bar (between the count row and the table Card): count + "selected on this
  page" + escalation link ("Select all N matching this filter", N = the list query's `total`);
  actions Status ▾ · Tags ▾ · Assign… · Export · | · Clear. Per-action capability gating via
  `canDo` (status/tags/assign need `leads.write`; Export needs `data.export`) — an action the
  seat lacks is absent, not disabled. Escalated tint = brand-soft with the filter named in
  words; page tint = surface-2. Count always in text (PRN-14 — the row wash never carries the
  meaning alone).
- **N6-54** Selected-row wash = brand-soft, distinct from the open-record row's surface tint
  (both can coexist on one row: open-record ring/current + selected wash).
- **N6-55** Results: success toast with the true split ("Assigned 641 · skipped 45") + a
  "View skipped" action opening a small dialog listing `skippedRefs` grouped by reason
  (bounded per N6-06, copyable). Selection clears on success. Errors: the uniform envelope →
  scoped toast, selection preserved.
- **N6-56** All states per FRONTEND_STANDARDS: bar/dialog controls implement
  default/hover/focus-visible/active/disabled/loading; dialogs trap focus (house Dialog);
  in-flight bulk actions disable the bar (loading state on the acting button).

## 7. Update-view (PR C)

- **N6-60** New menu item in `SavedViewsMenu` — `↻ Update "<name>"…` — rendered ONLY while a
  view is applied AND `modified` (the existing `savedViewKey` divergence oracle). It can never
  overwrite with identical filters or fire with nothing applied (guard test: item absent in
  both null-active and unmodified states — absence-not-presence, §8 rule).
- **N6-61** Confirm dialog (mockup copy): names the view and describes the incoming filters in
  words; primary "Update view". On confirm → the existing PATCH
  (`update.mutate({ id, filters })`); on success `active.filters` refreshes so "Modified"
  clears without a refetch race. Save-as-new + overwrite-by-name flows untouched.

## 8. Ctrl-K actions (PR C)

- **N6-70** `SearchItem` gains an action arm
  `{ kind: "action"; key; label; hint?; run: () => void }`; `go()` runs it (href arms
  unchanged). One cursor walks actions + results (existing pattern); cursor-reset covers the
  action list on open/term change.
- **N6-71** Zero-query state (today: dead until 2 chars) renders two groups:
  **Actions** — `Apply view: <name>` per saved view (`useSavedViews`, fetched when the palette
  opens; `views.own`), then on /leads only: `Clear filters`, `Open Columns` (hinted
  "this page"); **Go to** — the `NAV_SECTIONS` destinations (import the constant; no
  duplication). Typing < 2 chars filters actions by label substring; ≥ 2 chars shows matching
  actions ABOVE today's untouched search groups.
- **N6-72** Cross-tree dispatch (palette is mounted in the (admin) layout, outside the leads
  tree): on /leads, actions dispatch window events
  (`jv:leads-apply-view` `{ filters }`, `jv:leads-clear-filters`, `jv:leads-open-columns`) —
  the `lib/global-search.ts` open-event precedent; `LeadsBody` registers the listeners and
  routes them through the existing one-way `applyView` channel. Off /leads, `Apply view`
  navigates to `/leads?view=<id>` — the page shell already reads params server-side; the new
  param seeds the view through the same apply channel after the roster loads (invalid/foreign
  id degrades to no-op; the id never reaches a query unvalidated). NO mutations from the
  palette (owner decision — pinned by a test asserting the palette registry contains no
  mutating action).
- **N6-73** `ColumnsMenu` gains optional controlled `open`/`onOpenChange` props (uncontrolled
  default preserved) so the leads page can open it from the palette event.
- **N6-74** Hotkey semantics unchanged (Ctrl/⌘-K, re-entrant no-op, opener-focus restore).
  Footer hint gains "↵ run".

## 9. Testing (TST mapping)

- **T-1** (TST-01/01d) Tenant isolation on EVERY bulk resolver + export: same-user-OTHER-tenant
  rows for each mode; the tenant leg must be load-bearing (mutation-verify one leg per suite).
- **T-2** (TST-08-adjacent) Capability gates: member-without-`leads.write` → 403 on the three
  mutations; without `data.export` → 403 on export; viewer sees no checkbox column (UI test).
- **T-3** PRN-05: bulk assign before/after — `partner_id` + `match_method` byte-identical;
  only the manual overlay moves. Bulk status/tags never touch assignment columns.
- **T-4** Idempotency: bulk status re-run at the same target writes ZERO new history rows;
  bulk tag add re-run applies 0; both report the skip honestly.
- **T-5** Dry-run purity: `dryRun:true` performs no writes and no audit rows (count tables
  before/after), and its split equals the subsequent execute's split on unchanged data.
- **T-6** N6-02 strictness: corrupted/unknown filter keys → 400 + zero writes
  (mutation-verify: loosen the schema, watch the test fail).
- **T-7** Export: SEC-06 leg with a `=SUM(…)`-prefixed seller name AND a formula-prefixed
  filter-q in `Selection_Summary`; EXP-02 column order pinned; semantic determinism
  (re-render, compare) not byte-diff (TST-05).
- **T-8** Selection UI: escalate flip + drop-back, clear-on-filter-change, survives paging,
  tri-state header, toast split rendering, skipped-refs dialog.
- **T-9** Palette: action arm runs + closes, zero-query groups render, no-mutation registry
  pin, `?view=` seeding incl. foreign-id no-op.
- **T-10** Update-view: guard absences (N6-60), confirm PATCHes the applied id (not a
  name-resolved one), Modified clears.
- Worktree agents run `test:unit` and `test:integration --no-file-parallelism` SEPARATELY —
  never bare `pnpm vitest` (pooler phantom-red class), never concurrent with `pnpm build`.

## 10. Build shape & review plan

PR A (selection + the three bulk mutations + shared contract) → merge → PR B (export +
notify reuse) ∥ PR C (Update-view + Ctrl-K) — B/C branch from post-A main because A owns
`leads-view.tsx` and the shared schema. Per-PR review round: `pr-reviewer` on all;
**audit-tenancy on A and B** (bulk write paths + export egress); **audit-api-contract on B**
(EXP-02 + the new endpoints' envelopes); audit-design-system + audit-ux-flows on A's UI
surface. One consolidated fix round per PR (verify findings against code first). Merge on
green; `gh run watch` main CI after EVERY merge. No new dependencies. No migrations
expected (no schema change; if an index gap shows up under the set-based writes, it becomes
its own Tier-A ask, not a rider).
