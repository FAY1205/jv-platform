# WP-N3A: Runtime + dead-ends (deep-UX audit batch a)

Spec: DSN-03, PRN-12/14, LGL-01, FEP rules (§6.17) · Tier B/S · One PR.
Source: deep-UX audit 2026-08-19 (`_marketing/audit/deep-ux-audit-2026-08-19.md`),
candidates C-51 / C-55 / C-57 / C-49 in `docs/backlog/CANDIDATES.md`.
Owner decisions (tracker Slice 8, 2026-08-19): C-55 public `/terms` NOW + new-tab link.

All findings re-verified against current main (404d47ab) 2026-08-19 by the orchestrator.
Code wins over the audit text; re-verify each site before editing.

## Goal
Kill the one runtime error (portal hydration), unbreak the signup Terms dead-end with a
genuinely public /terms page, and close two mechanical consistency gaps (coverage-map
touch gate, coverage-summary adoption).

## Definition of done

### C-51 — portal-dashboard hydration fix (N3A-01)
- `Skeleton` gains an `as?: "div" | "span"` prop (default `"div"`, span renders
  `inline-block`) — additive, no call-site churn.
- `src/app/portal/dashboard/portal-dashboard.tsx:139-141` (Skeleton inside `<p>`) and
  `:197-199` (inside `<h2>`) use the span variant (or sibling placement) so no `<div>`
  sits in phrasing content. Both sites.
- App-wide sweep: grep every `<Skeleton` call site; fix any OTHER Skeleton rendered
  inside `<p>/<h1>-<h6>/<span>/<label>/<a>/<button>` phrasing parents. List swept sites
  (clean or fixed) in the PR body.
- Test: a unit test rendering the portal hero loading state asserting no `<div>` inside
  `<p>`/`<h2>` (e.g. render + query `p div, h2 div` = empty), named
  `it("N3A-01/C-51: portal hero skeleton is phrasing-safe (no div-in-p hydration mismatch)")`.

### C-55 — public /terms + signup new-tab link (N3A-02)
- New route `src/app/terms/page.tsx`: PUBLIC (server component fine, no auth), renders
  `TOS_TITLE` + `TOS_SUMMARY` + `CURRENT_TOS_VERSION` from `src/lib/legal/tos.ts` —
  the SAME single source the in-app gates render (one source of truth; the attorney text
  from WP-LGL-1 swaps in there later, this page updates for free). Include an
  effective-version line ("Version 2026-07-08"). Styling: the auth-card look (centered,
  Card) — it is a public legal page, keep it simple, tokens only (PRN-12).
- `/terms` must NOT be added to `PROTECTED_PAGE_PREFIXES` in `src/proxy.ts` (the list is
  a protected allowlist, so absence = public). Add a one-line comment in proxy.ts's
  public-pages comment block naming `/terms` as deliberately public (C-55) so a future
  sweep doesn't "fix" it.
- `src/app/signup/page.tsx:261`: consent link `href="/terms"` with `target="_blank"
  rel="noopener"` so the typed form survives.
- Both ToS GATE screens keep posting acceptance as today (out of scope to change them),
  but add a "Read the full terms" link to `/terms` (new tab) on
  `(admin)/tos/page.tsx` + `portal/tos/page.tsx` — same one-source text, lets the gate
  reference the public page. (Small, reversible; skip if it fights the layout.)
- NO other route-guard loosening. Do not touch PUBLIC_EXCEPTIONS.
- Test: route test asserting GET /terms renders without a session
  (`N3A-02/C-55: /terms is reachable signed-out`) — a proxy unit test on
  `isProtectedPage("/terms") === false` is acceptable if no page-level test harness fits.

### C-57 — coverage map touch gate (N3A-03)
- `src/app/(admin)/coverage/page.tsx` mounts `CountyCoverageMap` (lines ~91-97) with
  `interactive={isDesktop}` via the same `useIsDesktop()` gate the dashboard uses
  (`dashboard/page.tsx:135,254`). Mirror the dashboard comment.
- The pointer-copy line under the map ("scroll or use +/− to zoom, drag to pan") should
  not promise interactions phones don't have — gate that sentence on isDesktop too
  (C-48 §12.2 adjacency; one ternary, no new copy inventions: reuse the dashboard's
  approach if it has one, else render the keyboard-alternative sentence only).

### C-49 — coverage-summary adoption (N3A-04)
- `src/app/(admin)/partners/[id]/page.tsx:178` currently hard-prints
  `· N states · N ZIPs` (both segments unconditional → zeros show). Replace with
  `coverageSummary(partner.zipCount, partner.stateCount)` from `lib/coverage-summary.ts`
  (keep the leading `·` separator convention of that row).
- VERIFIED-STALE half: `coverage/page.tsx:~144` does NOT print the pattern — the legend
  filters to `stateCount > 0` (modules/coverage/map.ts:121) and prints states only, so
  there is no zero to fix there. Record this in the PR body as verified-not-applicable;
  do NOT restructure the legend payload.

## Out of scope
Anything N3b/N3c (hit targets, scrollHint, row-click, counts). MapCaption mobile hide
(Q10 → N3c). Changing TOS text or the acceptance flow. Turnstile copy (C-70 → N3c).

## Tests
tests/unit (component render for C-51; proxy/route for C-55). `pnpm tsc --noEmit` +
lint clean. Targeted vitest with `--maxWorkers=4` (Windows worker flake, C-77).
