# WP-B — AppShell + shell chrome (design)

**Date:** 2026-07-11 · **Status:** proposed, pending owner review · **Depends:** WP-A (Survey tokens, committed)
**Inputs:** `IMPLEMENTATION-PLAN.md` §WP-B, mockup `01-admin-dashboard.html` (shell markup), current `src/components/AppShell.tsx` + `ProfileMenu.tsx`.
**Scope:** the app shell only. No page body is touched (pages are reworked once, in WP-E). No primitive is re-skinned beyond the shell's own chrome (WP-C).

## 1. Confirmed decisions (owner, 2026-07-11)

1. **Topbar search:** keep search as an **expanding icon** in the right cluster (not a persistent box) — collapses to an icon, expands to a field on click/⌘K, submits to `/leads?q=`.
2. **Profile placement:** a **user block at the sidebar foot** (avatar + name + role) opens the profile menu; the topbar right cluster is search-icon · bell · theme. "Help & guides" moves into the profile menu.
3. **Brand mark:** adopt the **mockup route-glyph** (ink-stroked rounded square + marigold trend line + two dots) beside "TerritoryDesk" / "Operations".
4. **Page title (derived):** the topbar carries a `usePageHeader` **title + actions slot that stays empty in WP-B**. Every admin page still renders its own in-content `<h1>`; forcing a route title now would duplicate it, and stripping page h1s would touch page bodies — violating "touch every page exactly once." Each page moves its title into the slot (and drops its in-content h1) during its **WP-E** rework.
5. **Theme toggle:** lives in the topbar (per mockup); removed from the profile menu to avoid a duplicate control.

## 2. Sidebar reskin

- **Brand mark** (replaces the `JV` tile; the current tile is also `text-white` on `--brand` = AA-failing): the mockup SVG — `<rect rx>` ink stroke, a `--brand` (route) polyline `M7 24 L14 12 L21 19 L27 9`, ink + route end-dots — beside `<strong>{APP_NAME}</strong>` + a `--text-3` "Operations" subline. Links to `/dashboard`.
- **Nav groups** (regrouped per plan): **Route** (Dashboard, Leads·total) · **Review** (Unmatched·warn-tint, Imports) · **Network** (Partners, Coverage) · **Admin** (Rules, Activity, Settings). Active item stays `bg-brand-soft … text-brand-ink` (already correct post-WP-A); `aria-current="page"` kept.
- **Count badges:** Leads → neutral (`bg-surface-3 text-text-2`), Unmatched → warn-tint (`bg-warn-soft text-warn`, existing). Both `.num` tabular. Data via TanStack Query (PRN-15): Unmatched reuses `/api/leads/unmatched/count`; Leads uses a new `leadsCount(scope)` + `GET /api/leads/count` mirroring the unmatched route exactly (admin-only, scoped — PRN-08). Badges hidden when count is 0/loading.
- **User block (sidebar foot):** avatar (initials, `bg-surface-3 text-text-2` — not white-on-marigold) + name + role; it is the **ProfileMenu trigger** (§4). Replaces the current "Help & guides" foot link (Help moves into the menu).

## 3. Topbar reskin — one canonical cluster

`menu(mobile) · [PageHeader title + actions slot] · spacer · SearchExpand · NotificationBell · ThemeToggle`

- **Menu button:** unchanged behavior (desktop collapse / mobile drawer), token-snapped.
- **Title/actions slot:** renders `usePageHeader()` output; empty in WP-B (§4).
- **SearchExpand** (new small component, §5).
- **ThemeToggle** (new): a topbar icon-button cycling `setPreferences({ theme: nextTheme(theme) })`; icon reflects `usePreferences().theme` (sun/moon/auto); `aria-label` states the next theme. `useApplyTheme()` already syncs `<html data-theme>`.
- The current persistent `<form>` search box is removed from the header.

## 4. PageHeader mechanism

- `src/components/PageHeader.tsx`: a React context (`PageHeaderProvider`) holding `{ title?: ReactNode; actions?: ReactNode }` + a `usePageHeader(value)` hook (sets on mount via effect, clears on unmount). `PageHeaderProvider` wraps the shell in `AppShell`; the topbar reads the context and renders the title (as an `<h1>` in the bar) + actions.
- **WP-B:** provider + hook shipped; **no page calls the hook yet**, so the slot renders nothing. This is the seam WP-E pages fill (each page: `usePageHeader({ title: "Leads", actions: <…> })` and deletes its in-content `<h1>`).
- Rationale: keeps the shell as the single home of the title/actions cluster without touching page bodies now.

## 5. SearchExpand component

- Collapsed: a search icon-button (topbar right). Expanded: an inline input (border, `focus-within:border-brand-line`) with the placeholder + a `⌘K` kbd hint.
- ⌘K (global listener, moved here from AppShell) expands + focuses; Escape or blur-when-empty collapses; submit → `router.push('/leads?q=…')`. `aria-expanded`, `aria-label="Search"`.
- Lives in `src/components/SearchExpand.tsx` (shell chrome; all interactive states).

## 6. ProfileMenu relocation

- Trigger becomes the **sidebar user block** (`asChild` on the block button) instead of the topbar avatar-pill; `DropdownMenuContent` opens `side="top"`/`align="start"` from the foot.
- Content: identity label (email · role · workspace) · Settings · Component gallery (dev) · **Help & guides** (new, → `/dev/emails` as today) · separator · Sign out (destructive, unchanged logout flow). **Theme item removed** (now topbar).
- Avatar fill fixed to `bg-surface-3 text-text-2` (AA), matching the sidebar block.

## 7. Token-snapping (audit F-63) — shell chrome only

- Radii: `rounded-[10px]`/`rounded-[11px]` → `rounded-md` (12); `rounded-[5px]` (kbd) → `rounded-xs` (4, the WP-A token); brand tile → `rounded-md`.
- Sub-13px chrome text (DIRECTION "no chrome below ~13px", shell is touched here): nav group labels `text-[.62rem]` → `text-[0.8125rem]` (13px, `--step--1`) uppercase +.08em; count badges + `⌘K` kbd → `text-[0.8125rem]`; brand tile/subline + avatar initials sized off the scale.
- Icon boxes standardized: 18px nav / 16px topbar (consistent, no per-element arbitrary values).
- Brand shadow `shadow-[0_5px_14px_-6px_var(--brand)]` → token `shadow-sm`/none.

## 8. Accessibility & keyboard (preserve + verify)

- Mobile drawer keeps Esc + focus-move + return-focus + `inert` (F-70) — unchanged.
- Brand-mark polyline is decorative (`aria-hidden`); the link has its text label.
- Focus rings: the WP-A global `:focus-visible` outline (brand-strong) covers new buttons; SearchExpand/ThemeToggle get it for free.
- Every new interactive element (SearchExpand, ThemeToggle, user block) implements default/hover/focus-visible/active states (DSN-03).

## 9. Tests (requirement-ID named)

- `tests/unit/components/appshell.test.tsx` (new): F-63 nav renders the 4 groups in order + active item carries `aria-current` and route-tint classes; the Leads + Unmatched badges render their counts (mocked queries); ThemeToggle cycles the theme pref; SearchExpand expands on click and routes on submit; the PageHeader slot renders a provided title and nothing when absent.
- `leadsCount`: a query unit test (mirrors the unmatched-count test) + the route stays admin-scoped.
- Existing `ws7-components` ProfileMenu test updated for the relocated trigger (sidebar block) + removed theme item.

## 10. Out of scope (deferred, labeled)

- Page bodies / in-content `<h1>` removal / page actions population → **WP-E** (single-touch per page).
- Primitive re-skin (Badge/Select/DatePicker states, ring-brand focus hue F-3) → **WP-C**.
- Coverage/other maps → **WP-D**.

## 11. Acceptance / DoD

`pnpm check` core green (typecheck + lint + unit) · every admin page renders in the new shell · keyboard nav + focus ring intact · nav groups + brand mark + user block + expanding search + theme toggle present · new `leadsCount` scoped (PRN-08) · self-audit (PLAYBOOK §6) printed · pr-reviewer findings addressed · owner walkthrough approved.
