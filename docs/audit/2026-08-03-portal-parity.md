# Portal parity audit — admin ↔ partner cross-check — 2026-08-03 — phase-2/distribution @ 0d1b833

Owner ask (testing round 3, #4): "a proper cross-check between the admin portal and partner
portal so that the UI/UX, components, and feel in the partner portal matches the admin portal."

Agents: audit-ux-flows + audit-design-system (parallel, read-only), pr-reviewer on the
quick-fix diff. This file is the deduplicated synthesis.

## Landed with this audit (commit 0d1b833)

- **Export lead-source leak (the one verified portal leak):** `getPartnerExportData` now
  blanks the Campaign value and fetches only the caller's own partner row (PRN-08).
  Proven red→green in `tests/integration/portal-scope.test.ts`.
- **Role redirects:** all admin pages moved into the `(admin)` route group (URLs unchanged);
  one role-gate layout sends a partner on an admin URL to `/portal/dashboard`, and the portal
  layout sends an authenticated admin to `/dashboard`. Signed-out fall-through preserved
  (proxy owns the login redirect). 6 unit cases in `tests/unit/role-redirect-layouts.test.tsx`.

## Verdict

The portal is a deliberate, well-executed mirror of the admin patterns: shared primitives
(`FilterPill`, `LinkCard`, `HeroKpi`, `RowOpenButton`, `NotesPanel`, `PortalDevices`,
`PartnerTag`, `Pagination`), clean PRN-12 token discipline (no hex / `dark:` / brand literals
found in portal code), correct PRN-08/PRN-14 territory anonymization, 44px touch targets
throughout the mobile surfaces, and consistent loading/empty/error idioms (full state matrix in
the raw UX report). The drift that exists is concentrated and small.

## Findings (deduplicated, ranked)

| # | Sev | Finding | Anchors |
|---|-----|---------|---------|
| P-1 | High | Admin "status changed" notification deep-links to the orphaned read-only `/leads/[ref]` page (superseded by LeadDialog; no status history, no actions) — a dead end on the exact flow the notification announces | `src/modules/notify/outbox.ts:284`, `src/app/(admin)/leads/[ref]/page.tsx` |
| P-2 | High | Admin ProfileMenu "Help & guides" links to `/dev/emails`, which `notFound()`s in production — permanent 404 menu item | `src/components/ProfileMenu.tsx:86`, `src/app/(admin)/dev/emails/page.tsx:7` |
| P-3 | Med | `PortalShell` mounts no `ToastProvider` (AppShell does, ADR-0030); portal status update has no success feedback where the admin equivalent toasts; latent crash for any portal component that calls `useToast()` | `src/components/PortalShell.tsx`, `src/app/portal/leads/[ref]/page.tsx:49-62` |
| P-4 | Med | Portal desktop Leads table has no search (admin's does); the portal leads API accepts no `q` param at all — a partner with hundreds of leads pages through manually | `src/app/portal/leads/leads-desktop.tsx:76-94`, `src/app/api/portal/leads/route.ts` |
| P-5 | Med | Portal mobile bottom tabs never show the leads-count badge the desktop rail shows (admin shows it on both breakpoints) — phones are the primary partner surface | `src/components/PortalShell.tsx:211-229` vs `:138-171` |
| P-6 | Med | `ProfileMenu`/`PortalProfileMenu`: byte-identical trigger JSX duplicated, and sign-out logic duplicated (`use-sign-out.ts` vs inline) — promotion rule (2+ occurrences → primitive) | `src/components/ProfileMenu.tsx:36-68`, `PortalProfileMenu.tsx:35-53` |
| P-7 | Med | `HeroKpi` (shared by both dashboards) missing from `/gallery` — living-spec contract broken | `src/components/HeroKpi.tsx`, `src/app/gallery/page.tsx` |
| P-8 | Low | Portal ToS error lacks `role="alert"` (its stated admin mirror has it) — SC 4.1.3 | `src/app/portal/tos/page.tsx:44` vs `src/app/(admin)/tos/page.tsx:49` |
| P-9 | Low | Portal Activity uses a hand-rolled Prev/Next pager because `listPartnerActivity` returns no `total`; every other list uses the shared `Pagination` | `src/modules/activity/queries.ts:121`, `src/app/portal/activity/activity-*.tsx` |
| P-10 | Low | Portal desktop Leads table drops the "returning" (previouslyMatched) marker the mobile cards show | `src/app/portal/leads/leads-desktop.tsx` vs `leads-mobile.tsx:94` |
| P-11 | Low | Secondary auth-failure redirects drop `?next=` (both surfaces; proxy preserves it) | `src/app/portal/dashboard/page.tsx:14`, `src/app/(admin)/leads/[ref]/page.tsx:23` |
| P-12 | Low | Per-device "Sign out" in portal fires with no confirm; admin's session-ending action is two-step — **owner decision** whether one-click is intended | `src/components/PortalDevices.tsx:73-81` |

Adjacent (from pr-review, not parity drift): role-gate `/api/portal/*` routes explicitly
(today an admin session hitting the portal export gets tenant-wide semantics — not a leak,
but the route's "own leads" promise doesn't hold); consolidate the doubled `getServerScope()`
on `/dashboard` ((admin) layout + dashboard layout).

## Intentional scoping confirmed (do NOT "fix")

No source/campaign anywhere in the portal; no partner/routing internals on lead detail;
no source filter; no attention pills; `neutralUncovered` map anonymization; activity is
own-actions-only (no actor filter); 4-KPI dashboard without admin charts; notes mutual
invisibility (PRN-13) enforced server-side.

## Slices — ALL LANDED (phase-2/distribution, 2026-08-03)

1. **WP-PP-1 dead-end fixes (57ae127):** P-1 — status-change notification + AI citation now
   deep-link `/leads?open=<ref>` (auto-opens the full dialog); retired `/leads/[ref]` → redirect.
   P-2 — "Help & guides" (404'd in prod) relabeled to dev-gated "Email preview (dev)".
2. **WP-PP-2 portal toast (e23214a):** P-3 — PortalShell mounts `ToastProvider`; portal status
   mutation toasts success (mirrors admin StatusSelect).
3. **WP-PP-3 portal leads search (7f13021):** P-4 — `q` param on `listPartnerLeads` (ilike over
   seller/address/city/zip/ref, ANDed into the scoped baseWhere; PRN-08) + debounced input.
4. **WP-PP-4 consistency batch (06793ce):** P-5 mobile leads badge, P-8 `role="alert"`, P-10
   returning marker, P-11 `next=` threading, P-7 HeroKpi gallery entry.
5. **WP-PP-5 activity pagination (81fa49a):** P-9 — real `total` (two scoped count(*)) +
   selectable pageSize; both activity views use the shared `Pagination`.
6. **WP-PP-6 account-menu primitive (25bfb36):** P-6 — shared `AccountMenuTrigger` + generalized
   `useSignOut(redirectTo)`; gallery entry.

**Open owner decisions (not built):** P-12 device sign-out confirm; whether admin should ever
preview the portal (currently redirected away by design). Adjacent candidates carried from the
pr-review: role-gate `/api/portal/*` routes explicitly; dedupe the double `getServerScope()` on
`/dashboard`.

Raw agent reports: this synthesis supersedes them; state matrix and full evidence live in the
session transcript (agents were read-only; no `docs/audit/raw` files written).
