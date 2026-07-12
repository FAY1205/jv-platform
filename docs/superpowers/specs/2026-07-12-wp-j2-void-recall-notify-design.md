# WP-J2 — Void recall (global, ING-09) + partner notification

**Status:** design · **Branch:** phase-2/distribution · **Date:** 2026-07-12
**Inputs:** owner ⭐ decision F-2 (parts 2+3) · WP-J1 (grace window, shipped `a53c198`) ·
SPEC.md ING-09 · docs/backlog/WP-018.md follow-ups · current code: `src/modules/run/void.ts`,
`src/db/schema.ts`, `src/modules/settings/export-settings.ts`, `src/modules/notify/notifications.ts`
**Owner calls (2026-07-12):** (1) void **RECALLS** delivered leads — they vanish everywhere;
(2) **global** reach — from BOTH partner AND admin analytics/exports (full ING-09, not partner-only);
(3) **notify** affected partners, gated by an **admin setting** (default ON), **in-app only**.

---

## 1. The clean mechanism: soft-delete on void (not a per-read filter)

**Most** lead reads already filter `deleted_at IS NULL` and get global exclusion for free: coverage
(`coverage/queries.ts`), admin analytics (`analytics/queries.ts` — the dashboard "distributed"/
composition), partner KPIs (`partner-performance.ts`), admin leads list/detail/export
(`leads/queries.ts`), partner profile (`partners/queries.ts`), and dedupe (`store.ts` `loadHistory`).
So the core mechanism is to **soft-delete the run's leads on void** (`leads.deletedAt = voidedAt`) —
the WP-018.md follow-up.

**Corrected during build (integration-test-caught):** three classes of read did NOT filter
`deleted_at` (nothing soft-deleted a partner's leads before) and needed it added explicitly — the
**portal reads** `listPartnerLeads`/`getPartnerLeadDetail`/`getPartnerExportData` (`portal/queries.ts`),
the partner **status-update** (`portal/status-update.ts`), and **notes** (`notes.ts`, partner-only via
`scope.role`). And the partial index broke the pipeline's `ON CONFLICT (tenant, dedupe_key) DO NOTHING`
(`store.ts`) — the arbiter must name the partial predicate `WHERE deleted_at IS NULL`, and the
ref-id resolution lookup must prefer the live row. All caught by the DB integration test.

**"Remaining visible in history as voided" (ING-09) falls out for free:** `getRunDetail`
(`run/queries.ts:59`, the import-detail RunView) is the ONE lead read that does **not** filter
`deleted_at` — so the voided run's leads stay visible on its own import page (marked voided), while
disappearing from every aggregate/list/export. Exactly the spec's intent.

## 2. Required migration — partial unique index (DM-09)

Today `uniqueIndex("leads_tenant_dedupe_idx").on(tenantId, dedupeKey)` is **not** partial. Once a
lead is soft-deleted, re-uploading a corrected file whose row has the same `dedupe_key` would collide
with the still-physical soft-deleted row (the pipeline treats it as new — `loadHistory` excludes
soft-deleted — and tries to INSERT). Fix per WP-018.md:

- **Migration** (`src/db/migrations/00XX_*.sql` + drizzle): drop `leads_tenant_dedupe_idx`, recreate it
  as **partial** `... WHERE deleted_at IS NULL`. Update `schema.ts` to `.where(sql\`deleted_at is null\`)`.
- Per the repo rule ("every schema change = migration + seed + RLS + index in the same PR"): RLS on
  `leads` is unchanged (row-level tenant policy already covers soft-deleted rows); no seed change; the
  index IS the change. Run `pnpm db:migrate` (env-sourced) + re-generate types if needed.

## 3. voidUpload — recall + notify (one transaction)

Extend `voidUpload` (`src/modules/run/void.ts`), inside its existing `db.transaction`:

1. (unchanged) load upload; guards: not-found → already-voided → **window closed** (WP-J1).
2. **Capture affected partners BEFORE soft-delete** — distinct effective owners
   (`coalesce(manual_partner_id, partner_id)`) of this upload's not-yet-deleted, kept leads, with a
   per-partner count. (Uses the canonical `partnerOwnsLead`-style predicate.)
3. (unchanged) set `uploads.status='voided' + voidReason + voidedAt`.
4. **Soft-delete the run's leads:** `update leads set deleted_at = voidedAt where tenantId
   AND upload_id = upload.id AND deleted_at IS NULL`. PRN-05-safe — assignment columns
   (`partnerId`/`manualPartnerId`) are **untouched**; the row persists (PRN-03), just flagged deleted.
5. (unchanged) append the `upload.voided` audit row (DM-04).
6. **If `void_notifies_partners` is ON:** `createNotification(tx, …)` per affected partner — in-app
   only, SEC-05 (refId/count + upload ref only, **never seller PII**): e.g. type `run_voided`,
   "N leads from a withdrawn import (IM-##) were removed from your list." Pass `tx` so it's atomic.

`voidUpload` now returns the affected-partner count too (for the admin confirm/toast).

## 4. Notify setting (PRN-11)

New tenant setting `void_notifies_partners` in the generic `settings` table (tenantId+key+JSON —
**no migration**, mirrors `color_coding` in `settings/export-settings.ts`):
`VOID_NOTIFIES_PARTNERS_KEY`, `coerceVoidNotifiesPartners` (default **true** — only explicit stored
`false` disables), `loadVoidNotifiesPartners`, `saveVoidNotifiesPartners`. `voidUpload` reads it
(passed in by the route, or loaded in-tx). UI: a `Switch` in Settings (Data & Export or Notifications
group) wired through the existing settings API pattern.

## 5. Copy — now truthful (reconciles the WP-J1 revert)

With recall real + global, the import-detail copy becomes accurate:
- Modal: the "does **not** recall leads already delivered" paragraph is **removed**; replaced with the
  real effect — "Recalls its **N** distributed leads from partners (removed from their lists, exports,
  and stats) {and notifies them}; excludes every lead from dedupe, analytics, and exports; stays in
  history as voided." Gated on `distributed`/the setting.
- Voided banner: "excluded from future dedupe, analytics and exports" is now **true** — keep.
- This closes the WP-J1 pr-review F-1 (the ING-09 copy is now backed by implementation).

## 6. Non-negotiables

- **PRN-08 / audit-tenancy (mandatory):** the recall is achieved via a global soft-delete honored by
  the existing scope-guarded reads — no read bypasses `leadWhere`/`tenantWhere`. The affected-partner
  capture is tenant-scoped. Prove no cross-tenant/partner leak (TST-08).
- **PRN-05 / PRN-03:** soft-delete never rewrites assignment history; rows persist + stay visible on
  the import page.
- **PRN-15:** partner + admin KPIs recompute lower automatically (leads filtered) — numbers still come
  only from analytics; nothing re-derived.
- **PRN-01:** any new pure helper (e.g. the notification message builder) takes inputs → string.
- **SEC-05:** the recall notification carries no seller PII.
- **DM-08 / goldens:** no rules snapshot affected; no export-bytes golden. The dedupe VERDICT is
  unchanged (`loadHistory` already excluded voided/soft-deleted); only physical re-insert is unblocked
  by the partial index.

## 7. Tests (TDD)

- **Migration/re-upload (integration):** soft-delete a lead, re-insert same `dedupe_key` → succeeds
  under the partial index (would fail today). ING-09/DM-09.
- **Recall global exclusion (integration, extends `void.test.ts`):** after void, the run's leads are
  gone from admin analytics (`analytics/queries`), the admin leads list, partner reads
  (`listPartnerLeads`/perf), and export data — but STILL present in `getRunDetail`. TST-08: a partner
  scope sees zero of the recalled leads.
- **Notify (integration):** with setting ON, each affected partner gets exactly one `run_voided`
  notification (no PII); with setting OFF, none. PRN-11 default proven.
- **Setting coerce (unit):** `coerceVoidNotifiesPartners` default true; explicit false disables.
- **Affected-partner capture (unit or integration):** distinct effective owners + counts correct
  (manual overlay wins).

## 8. Reviews & walkthrough

- **audit-tenancy** (mandatory) + **audit-data** (migration safety, partial index, transaction) +
  **audit-api-contract** (void response gains partner-count + the notification) + **audit-pipeline**
  (dedupe/re-upload interaction) + **pr-reviewer**. audit-a11y for the settings Switch if styling is
  non-trivial (reuse the existing `Switch`).
- Walkthrough: void a fresh run in the running app → show the partner's list/KPIs drop + the in-app
  notification + the run still visible on its import page; toggle the setting off → no notification.

## 9. Out of scope

- Un-void / restore (void stays terminal; the grace window already bounds it).
- Changing the notification channel to email (owner chose in-app only).
- Retention-sweep interaction (unrelated soft-delete path).

## 10. Review remediation (5-agent battery, all folded in)

The initial build assumed "every read filters `deleted_at`" — the audits (tenancy/data/pipeline/
api-contract/pr) found **five** reads that did NOT, all now fixed + integration-tested:
- **Per-run admin export PII leak (High ×4):** `getRunExportData` filters `deleted_at`; the export
  route returns 409 for a voided run (before the stored-blob redirect that would serve pre-void PII);
  the Download link is hidden when voided.
- **Partner Activity feed (High):** `listPartnerActivity` (status + notes) filters `deleted_at`.
- **Coverage map (High):** `coverageMapData` `leadByState` + `unmatched` now filter (like `volume`).
- **Legacy backfill (High):** migration **0018** soft-deletes leads of pre-WP-J2 voided uploads (they
  had `status='voided'` but live leads) so legacy runs are consistent + re-uploadable.
- **Post-run steps + scope guard (defense-in-depth):** `outbox`/`run-checks` filter `deleted_at`; the
  partner `ownLeads` subqueries in `scope.ts` (`leadChildWhere`/`noteWhere`) exclude deleted (DM-09b).
- **Concurrency + conformance:** `voidUpload` takes the ING-06 advisory lock (serializes double-void),
  uses `tenantWhere`, and notifies via the shared `createNotification` (with a `deepLink`); the admin
  gets a "N leads recalled from M partners" toast.

Tests added: TST-08 exclusion across partner list/export/activity + status-update rejection; the
manual-overlay affected-partner branch (ANA-02); export-blocked. Void integration suite 8/8 green.

## 11. Deferred WP candidates (from the review)

- **Zero-downtime index rebuild** (data F-2 / pipeline F-6): migration 0017 rebuilds the `leads`
  unique index non-`CONCURRENTLY` inside the migration transaction → an `ACCESS EXCLUSIVE` lock. Fine
  on the small dev table; a **populated-prod deploy must** use `CREATE UNIQUE INDEX CONCURRENTLY … →
  DROP INDEX CONCURRENTLY → rename` out-of-transaction. Draft **DM-12**.
- **Retention for soft-deleted PII** (SET-07b): voided-run leads (seller PII) now persist
  soft-deleted with no purge path — fold into the retention sweep.
- **Notification-prefs consolidation:** `run_voided` uses a standalone `void_notifies_partners`
  setting instead of the per-event `notification_prefs` matrix; consolidate once an email channel is
  decided.
- **ING-09 email correction notice:** the spec's "partner digests already sent get a correction
  notice" is in-app only here (owner: in-app only) — email correction is a later option.
- **`run_voided` notification tone:** falls back to `neutral`; add to `notificationTone` if a distinct
  tile is wanted.

## 12. Tenancy re-review (post-remediation) — airtight, with test-hardening follow-ups

The re-review enumerated **every** lead-derived read and confirmed the recall is **airtight for
partners — no Critical, no High isolation defect**; the only remaining "missed read" was an
admin-only analytics accuracy drift, now fixed. Folded in: **F-1** — the dashboard "Closed" KPI CTE
(`analytics/queries.ts`) counted recalled leads' Closed events (`lead_status_history` without a live-
lead join); now constrained to `deleted_at IS NULL` leads (DM-09). **F-3** — the `void.ts` affected-
partner raw SQL now interpolates `tenantWhere` instead of a hand-rolled `tenant_id =`. **Tracked
test-hardening follow-ups** (defenses are implemented + verified-by-reading; the mechanisms are
integration-tested, but these specific regression guards aren't): a route-harness test that
`GET /api/runs/[ref]/export` → 409 for a voided run on BOTH the stored-blob and regen paths (F-2,
Medium — the stored-blob 409 is the actual PII barrier); and a `coverageMapData` assertion that a
recalled lead drops from `leadByState`/`unmatchedLeadCount` (F-4, Low).
