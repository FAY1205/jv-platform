# WP-N5 — Lead record redesign: side panel, inline editing, N-of-M navigation

**Status:** spec approved for build (owner sign-off 2026-08-20; mockup
[artifact ac016d20](https://claude.ai/code/artifact/ac016d20-8d86-4adf-818f-6250f49e4af4)).
**Absorbs:** C-59. **Does NOT include:** C-82b (Q7 answered: defer), Timeline v2 diffs (N7).
**Spec sections to read first:** §6.17 (frontend rules), §6.18–6.19 (security), §3/§6 PRN table.

## Owner decisions binding this WP (PENDING-TRACKER Slice 8, 2026-08-20)

1. **Layout = side panel**, right slide-over, **non-modal**: no scrim, the leads table stays
   visible and clickable, clicking another row switches the record. ~600px at desktop.
2. **Editing = inline per-field** (click-into-field). **Commit-on-blur**: Enter/blur saves,
   Esc reverts, failed save toasts + reverts. NO whole-panel save dialog. The whole-view
   Edit toggle retires.
3. **Prev/next "N of M" pager** in the panel header (C-59), honoring the list's current
   filters + sort, with ↑/↓ keyboard navigation.
4. **Property → Google search link stays** (Q4), admin + portal.
5. Field edits produce a **names-only "Details updated" timeline entry** (no values;
   before→after diffs are N7's).
6. The **ref stays the record title**; seller name stays a field.
7. **Portal adopts the same panel in N5**, read-scoped.
8. **Quality bar (owner qualifier, twice):** layout, spacing, alignment, readability, and
   accessibility to best practices — audit-a11y + audit-design-system run on the new surface
   before merge; UX-state matrices complete on every new interactive component.

## Verified ground truth (file:line, checked 2026-08-20)

- `src/app/(admin)/leads/lead-dialog.tsx` — the current record: ViewMode field grid (:250),
  ScorePanel (:397), TasksPanel mount (:356), Timeline (:358), NotesPanel (:363), EditForm
  (:450) with transfer confirm (:607–637), partnerActionFor/transferCopy (:96–138),
  property Google link (:292–304), C-41b placeholder flow (:158, :167).
- `src/app/(admin)/leads/leads-view.tsx` — owns the working set: `LeadsPage {leads,page,
  pageSize,total}` (:45), `openRef` state + `?open=` seed/close URL discipline (:118–145),
  `onOpen` wiring (:217, :228), dialog mount (:235). Server-side filter/sort/page.
- `src/app/(admin)/leads/[ref]/page.tsx` — retired page; redirects to `/leads?open=<ref>`
  (P-1). **Unchanged by this WP** — deep links keep working because `?open=` still opens
  the record (now a panel).
- `src/components/Dialog.tsx` — Radix-backed; confirmClose overlay (:127), pinned
  header/footer + scroll-hint body (:84–123), C-52 close-target reach (:96–105). The new
  SidePanel is a SIBLING primitive, not a Dialog mode.
- `src/modules/leads/schema.ts` — `EditLeadSchema.fields` all `.optional()` (:157–165) →
  a single-field PATCH is already valid input.
- `src/modules/leads/commands.ts` — `editLead` builds an only-changed-keys patch (:278–300),
  recomputes dedupe on address/zip change (:307–312), audits `lead.edited` with PII-masked
  before/after **in the same tx** (:366–375). `EDITABLE_COLUMNS` (:250) is the canonical
  editable-field list — the client field roster derives from it conceptually; do not add
  fields.
- `src/modules/leads/queries.ts` — `getAdminLeadDetail` assembles `activity[]` from
  authoritative columns only (:582–625); the shared-kind note (:490–494) says a new kind
  must be mirrored in the client union. Detail reads are one `Promise.all` (:549) — keep
  the new audit-log read inside it.
- `src/components/Timeline.tsx` — `TimelineEntryKind` union (:15), `DOT` map (:31),
  `matchesTimelineFilter` (:52).
- `src/app/api/leads/[ref]/route.ts` — GET detail (:18), PATCH edit (:39; CSRF + capability
  `leads.write` + Zod). Status has its own endpoint (`/api/leads/[ref]/status`, used at
  lead-dialog.tsx:497).
- `src/app/portal/leads/portal-lead-dialog.tsx` — portal record (read-scoped, status
  control + listing badge, no score/partner internals). Same-section structure; adopts the
  panel shell in PR C.

## Requirements

### A. SidePanel primitive + admin record panel (PR A)

- **N5-01** New `src/components/SidePanel.tsx`: right-anchored, full-height, non-modal
  slide-over. No scrim; page behind stays interactive. Esc closes (unless an inline edit is
  active — see N5-13); ✕ closes; focus moves into the panel on open and returns to the
  opener on close. Radix `Dialog` with `modal={false}` (or equivalent) so a11y semantics
  (`role="dialog"`, labelled by the ref) hold without a focus trap. Width 600px ≥1100px;
  overlays more of the table at 768–1100px (min content width ~560px, field grid drops to
  2 columns); below 768px it is a full-screen sheet. Slide animation respects
  `prefers-reduced-motion`. Complete state matrix (open/closing/reduced-motion/keyboard).
- **N5-02** The leads page mounts the record in the SidePanel instead of the Dialog. All
  existing `?open=<ref>` behavior is preserved verbatim: seed-on-prop-change idiom, close
  drops the param with `replace` (leads-view.tsx:118–145), SRCH-02 re-open of the same
  ref, P-1 redirect. Row click while the panel is open **switches** the record in place
  (`setOpenRef`), not close-and-reopen.
- **N5-03** ViewMode content ports intact: C-41b placeholder/partial flow, PendingField
  skeletons, ScorePanel, TasksPanel, Timeline, NotesPanel, property Google link (Q4),
  Field "Not provided" demotion. No behavior regressions; PRN-12 tokens only.
- **N5-04 (C-59)** Header pager: `‹ N of M ›` where the working set is the CURRENT
  filtered+sorted list and M is the query's `total`. N = (page−1)×pageSize + row index + 1.
  ↑/↓ (and the buttons) move prev/next; crossing a page boundary calls the list's page
  change and opens the adjacent row when the page data lands; at the ends the arrow is
  disabled (real `disabled`, it's a data boundary not a permission). While the neighbor
  page is in flight the pager shows a pending affordance — no double-fire. Arrows never
  fire while an inline edit is active or when focus is in an input/textarea/select.
- **N5-05** Pager renders **only when the open ref is present in the current working
  set** (deep-linked leads outside the filter show the record without a pager — never a
  lying "1 of 686"). aria-labels name the action ("Previous lead"); N-of-M is
  `tabular-nums`.
- **N5-06** Status + partner become always-visible dedicated controls in the panel
  (replacing their EditForm homes): status drives the existing `/api/leads/[ref]/status`
  endpoint; partner select reuses `partnerActionFor` + `transferCopy` and keeps the
  confirmation dialog for every ownership-moving action (ASN-03/FRM-03) — the confirm
  copy is unchanged. Removed-MLS leads keep the read-only status treatment
  (lead-dialog.tsx:563–567) and `editable:false` gating.

### B. Inline per-field editing + timeline entry (PR B)

- **N5-10** New `src/components/InlineField.tsx` (or sibling): states rest / hover /
  focus-visible / editing / saving / error / disabled — the full §6.17 matrix. Hover+focus
  show tint + pencil; click (or Enter on the focused field) opens in-place editing with the
  value pre-selected. Multiline variant for Source notes.
- **N5-11** Commit-on-blur: Enter or blur saves **that field only** (`PATCH
  /api/leads/[ref]` with a single-key `fields`); Esc reverts and exits; unchanged value =
  no request. Optimistic UI with rollback + toast on error ("Couldn't save <Field> —
  retry"; retry reopens the field with the attempted text). Query invalidation matches
  today's onSaved set (lead-dialog.tsx:200–209) — lead, leads, dashboard (+coverage only
  on partner moves, which live in N5-06 not here).
- **N5-12** Editable fields = exactly today's EditForm roster (schema.ts:157–165 minus
  motivation, per VP-4c): sellerFirst, sellerLast, phone, email, address, city, state
  (2-char uppercase mask kept), zip, campaign, reasonForSelling, timeToSell, notes.
  Everything else (Routed by, Received, MLS, score) is not editable inline or otherwise.
  Address/zip edits may 409 on dedupe collision — surface the server message in the toast.
- **N5-13** Esc precedence: an active edit consumes Esc (revert); a second Esc closes the
  panel. The old whole-view EditForm + `editing`/`editDirty`/`confirmClose` plumbing
  retires with tests updated — no dead code left (audit-hygiene).
- **N5-14** Timeline entry "Details updated": derived in `getAdminLeadDetail` from
  `audit_log` rows `action='lead.edited'` for this lead (tenant-scoped through the scope
  builders — PRN-08; actor via the same guarded users join as status history,
  queries.ts:562). Label = "Details updated: phone, email" — changed-field display names
  only, **never values** (the audit values are masked anyway; SEC-05). Skip pure
  partner-move rows (their `assigned` entry already exists — no double entry). The read
  joins the existing `Promise.all` (queries.ts:549) — no new waterfall. New
  `TimelineEntryKind` `"details_updated"` added to Timeline.tsx union + DOT + filter map
  and mirrored client-side per the queries.ts:494 convention. **Admin timeline only** —
  the portal feed does not gain this kind in N5 (portal shows today's content; widening is
  an owner call).
- **N5-15** Concurrency: a per-field save landing while another field is editing must not
  clobber the editing field's draft (detail refetch keeps the draft local). Two rapid
  edits to different fields both persist (server patch is per-changed-key — verified).

### C. Portal adoption (PR C)

- **N5-20** The portal record moves into the same SidePanel shell, read-scoped: exactly
  today's portal-lead-dialog content (fields as text, status control, listing badge, their
  tasks/timeline/notes, Google link). No inline editing, no pager in N5 (portal list is
  its own working set; pager there is a candidate). Full-screen sheet below 768px — this
  is the portal's primary reality; verify on the mobile viewport.
- **N5-21** PRN-08/PRN-13 unchanged: the portal payload and note walls are untouched;
  audit-tenancy runs on any query-path diff.

### Cross-cutting

- **N5-30** Accessibility (owner quality bar): panel labelled by the ref; every editable
  field reachable and operable by keyboard alone; visible focus states; pager buttons ≥24px
  targets (C-52 conventions, coarse-pointer reach where the Dialog ✕ set precedent);
  status/error changes announced (`aria-live` on save errors); AA contrast on the hover
  tint in both themes; PRN-14 (partner name + ref accompany color).
- **N5-31** Tests carry requirement IDs. Suites: SidePanel behavior (non-modal, Esc
  precedence, focus return), pager math incl. page-boundary + not-in-working-set +
  filtered M, InlineField state machine + rollback, details_updated derivation (masked
  values never surface; partner-only audit rows skipped), portal parity (TST-08 note-wall
  cases re-run on the new surface), deep-link regression (`?open=`, P-1 redirect).
- **N5-32** No new dependencies. No schema change (the audit log already holds what N5-14
  needs — if an implementer concludes a migration IS needed, stop and flag, don't build).

## Build order + review

PR A → PR B → PR C (B and C both build on A; C may run parallel to B after A merges).
Worktree agents: copy `.env.local` FIRST, `pnpm install`; `vitest --maxWorkers=4`;
integration batches serial (test-DB pooler caps at 15 clients). Reviews per PR:
pr-reviewer always; audit-tenancy on any query-path diff (PR B server change, PR C);
audit-design-system + audit-a11y on the new record surface (PR A, and B's InlineField);
consolidated fix round per PR; merge on green CI; `gh run list --branch main` after every
merge (PR CI skips e2e).
