# WS-7 — Settings + Notifications + Profile menu · design

**Program:** REDESIGN-R3 §4 WS-7 · **Branch:** ws-7/settings (off phase-2/distribution)
**Spec:** SET-01/03/07/08/09/10/12, ACC-02, AUT-08/12/13/14, EXP-06, ING-07, PRN-08/12/14/15 · **Date:** 2026-07-10

The largest page WP. Executed as internal **slices** (one commit each) on a single branch,
merged once when WS-7 is complete (one WP = one merge). Owner deferred all page walkthroughs
to end-of-program, so slices land without per-slice walkthrough.

## Current state (from the 3-agent sweep)
- No `/settings` hub — only `/settings/notifications`. WS-7 introduces the hub + left-nav layout.
- Theme: full dual palette in `globals.css` (`prefers-color-scheme` + `[data-theme]` override);
  nothing sets `data-theme`; no prefs store (zustand not a dep; precedent = raw-localStorage `jv.nav`).
- AppShell top-right profile `<button>` is a static "A/Admin" placeholder; no client identity
  source (no `/api/me`). `DropdownMenu` primitive ready (gallery-only so far).
- Password flow: `/account/password` (AppShell-less) + `/api/auth/change-password` + `lib/auth/password.ts`.
- Sessions: trusted-device family model. `GET /api/sessions` (self-scoped) + `POST /api/sessions/[familyId]/revoke`
  (already allows admin-revokes-partner). `POST /api/auth/logout?scope=global` exists, wired to no UI.
- `color_coding`: seeded in `settings`; `render.ts` parameterized; **3 call sites hardcode `true`**, no getter (F-39).
- Notification prefs: generic `settings` row `notification_prefs` (per role×event, email+inApp). No cadence.
- NotificationBell: hand-rolled; no error state (F-21), no aria-live (F-7), fixed 20s poll (F-87).
- File formats card on `/rules` (WS-6 carry-over) backed by `listProfiles`, bundled in `/api/admin/rules`.
- Settings persistence: one generic `settings` (tenantId,key,value jsonb) table; pattern = `modules/notify/prefs.ts`.

## Key decisions
1. **One UI-preferences store, no new dependency** (7a): `src/lib/preferences.ts` — a tiny
   `useSyncExternalStore` over localStorage holding `{ theme, navCollapsed }`. Generalizes the old
   `jv.nav` flag. zustand would need an ADR; boring wins. Theme "system" ⇒ no `data-theme` (CSS decides).
2. **Password flow moves into Settings → Profile** (7c): reuse the existing route/module unchanged
   (AUT-01/02/08 intact); only the page host changes (AppShell-framed under /settings).
3. **Security section reuses the sessions API** (7e): admin views their OWN sessions (ACC-02);
   "sign out everywhere" wires the existing `POST /api/auth/logout {scope:"global"}`. Admin-revokes-
   partner already supported by the revoke route but the admin *partner-session* UI is deferred to a
   later WP (ACC-02 self-scope satisfied now). AUT-08 recent-re-auth already enforced server-side.
4. **F-39 color_coding**: add a scoped `loadColorCoding`/`saveColorCoding` (settings-table helper,
   `notify/prefs.ts` pattern) and replace the 3 hardcoded `colorCoding: true` with the read (7g).
5. **File formats relocation** (7g): split `formats` out of `/api/admin/rules` into a settings
   endpoint; move the card to Settings → Data & Export; `/api/templates/[id]` unchanged. SET-12
   view/edit/version is net-new and stays OUT of scope (read-only list + template download only).
6. **Billing/Team = stubs**; **Workspace = name + brand placeholder**; **Appearance = theme control**.

## Slices (each a commit; TDD where logic exists)
- **7a — Preferences store + Appearance foundation** ✅: `lib/preferences.ts` (+unit tests); AppShell
  applies theme app-wide (`useApplyTheme`) and migrates nav-collapse onto the store.
- **7b — Settings hub shell + IA**: `/settings/layout.tsx` left-nav (8 sections) + `/settings` index;
  existing notifications page re-homed under the nav. Billing/Team stub pages.
- **7c — Profile + Appearance + Workspace sections**: Profile (name/email read-only + password change
  moved in), Appearance (theme segmented control on the store), Workspace (name + brand placeholder).
- **7d — Profile dropdown + `/api/me`**: replace the static AppShell button with `DropdownMenu`
  (avatar/name/email header, links to Settings + Gallery(dev), inline appearance toggle, sign out →
  `/api/auth/logout`). New `GET /api/me` (scoped identity).
- **7e — Security section** (Tier A): admin's active sessions/devices (reuse `GET /api/sessions`),
  per-row revoke, sign-out-everywhere. AUT-12/13/14.
- **7f — Notifications rebuild**: settings prefs UI onto `Checkbox`; NotificationBell rebuilt on
  `DropdownMenu` — grouped-by-day, mark-all-read, per-item read, honest error (F-21), aria-live unread
  (F-7), visibility-aware polling (F-87).
- **7g — Data & Export**: `color_coding` getter wired to the 3 export call sites (F-39, EXP-06);
  retention placeholder copy (SET-07); relocate File-formats card from Rules → Settings.

## Acceptance
- Every reworked surface uses WS-1 primitives (no raw selects/inputs/modals); token contrast holds.
- New logic unit-tested with requirement IDs; DB-touching tests self-skip locally, run in CI.
- `color_coding` no longer hardcoded; `/rules` no longer serves `formats`; `/api/me` scoped (PRN-08).
- pr-reviewer pass + §6 self-audit per merge. Browser walkthrough at end-of-program (owner).

## Deferred (tracked)
- SET-12 Source-Profile view/edit/version editor (net-new; not read-only list). 
- Admin viewing/revoking *partner* sessions UI (API supports it; ACC-02 self-scope shipped now).
- SET-09 real branding editor (placeholder only); SET-08 timezone/date-format UI; retention *sweep*
  implementation (F-37, placeholder copy only); digest cadence control (no schema for it).
- Rules SPEC CVG-02 doc reconciliation (carried from WS-6).
