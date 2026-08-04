# Survey Identity — Implementation Plan (next session)

**Status:** ready to execute · **Approved by owner:** direction 2026-07-10, real-map revision + self-review fixes 2026-07-11
**Inputs:** `DIRECTION.md` (token system, source of truth), `mockups/` (per-page visual spec), `AUDIT.md` (what to keep/kill), `docs/backlog/REDESIGN-R3.md` (program this folds into).

## Context

The "Survey" identity (petrol ink on survey paper, one marigold accent, Fraunces/Hanken Grotesk/IBM Plex Mono, the real US coverage choropleth as signature) is approved as **design artifacts**. This plan turns it into the app. It deliberately rides the existing architecture — the dual token source (`src/lib/tokens/tokens.ts` + `src/app/globals.css`, SEAM-08), Radix primitives, TanStack Query, and the existing map components — so this is a **re-skin + page-spec adoption**, not a rebuild.

**Sequencing decision (recommend, confirm with owner):** land WP-A/B/C/D as a "WS-1.5 identity foundation" *before* REDESIGN-R3's WS-2..8 page reworks, then execute WS-2..8 using the mockups as each page's visual spec — every page still gets touched exactly once, in the new language. R3's functional scope (§4) is unchanged.

## Non-negotiables that bind this work

- PRN-12: all values land in the two token homes only; components consume tokens. The rebrand is exactly the token-swap PRN-12 was designed for.
- PRN-14: partner color never alone — `PartnerTag` (swatch + name + JV-ref) survives unchanged as a rule; only tint values change.
- Every WP: `pnpm check` green; tokens contrast test green; requirement-ID test names; no new deps without an ADR (none are needed — `next/font` is built-in).
- DM-08 / goldens: partner palette changes flow into the Excel export → goldens re-pinned **once**, with rationale, in WP-A.

## Work packages

### WP-A — Token foundation (the identity lands here)
1. **ADR-0020**: "Survey visual identity v2" — records the palette/type/signature decision and that the route-line concept was rejected.
2. `src/lib/tokens/tokens.ts` + `src/app/globals.css`: swap to the Survey values in `DIRECTION.md` §Token system v2 (light + dark: paper/surface/ink tiers/line/route family/matched/info/warn/danger, shadows, radii 4/8/12/16, motion 120/200/320ms). Keep the existing var *names* where semantics match (`--bg`→`--paper` rename optional — prefer keeping existing names and changing values only, to shrink the diff; map: bg=paper, brand=route, brand-soft=route-tint, etc. Decide in-session, record in ADR-0020).
3. **Type:** root `font-size: 16px`; load **Fraunces (display), Hanken Grotesk (body), IBM Plex Mono (mono)** via `next/font/google` in `src/app/layout.tsx` with the mockups' fallback stacks; scale 1.2 ratio; kill all sub-13px chrome text (the `.62rem`–`.66rem` cluster) as pages are touched.
4. **Partner palette:** replace `PARTNER_PALETTE`/`PARTNER_SWATCHES` with the printed-map tints (clay/sage/slate/ochre/plum/teal/rust/moss/denim/brick — hexes in `DIRECTION.md`). Re-vet AA as fills via the existing contrast helpers.
5. **Tests:** update `tests/unit/tokens.test.ts` computed-contrast assertions to the new pairs (the checked matrix + measured ratios are in `DIRECTION.md`; note **light `warn` on surface = 3.76:1** — warn is UI-signal/large-text only, never body text, or darken to ≥4.5 in-session). Re-pin export goldens once.
**Acceptance:** `pnpm check` green; both themes render; `/gallery` shows the new tokens; goldens re-pinned with rationale.

### WP-B — AppShell + shell chrome
- Reskin `src/components/AppShell.tsx`: nav regrouped **Route** (Dashboard, Leads) / **Review** (Unmatched, Imports) / **Network** (Partners, Coverage) / **Admin** (Rules, Activity, Settings); marigold `route-tint` active state; brand mark from mockups; count badges (Leads total, Unmatched warn-tint).
- **One topbar cluster everywhere:** menu (mobile) · page title · page actions · bell · theme · avatar — the mockups drifted here; the single component is the fix.
- Snap the off-scale radii/icon sizes to tokens (audit F-63) while in the file; mobile drawer already has Esc/focus handling per R3 WS-8 — keep.
**Acceptance:** every admin page renders in the new shell; keyboard nav + focus ring intact.

### WP-C — Primitive re-skin (all in `/gallery`, all states)
- `Button` (primary = marigold fill + ink `#20160A` text), `Badge` (**semantics fixed by the self-review:** Distributed=route-tint · New=info · Unmatched=warn · Matched=matched · destructive/error=danger), `Card`, `Table` (hairline rules, right-aligned tabular-mono numerics, partner rail), `Stat` (Fraunces numerals), `Input`/`Select`/`Checkbox`/`DatePicker` focus rings, `Toast`, `Dialog`, `Skeleton`, `EmptyState`, toggle switches (**on-state = route, everywhere**).
**Acceptance:** gallery current (DSN-03), state matrix complete, no raw hex.

### WP-D — Maps
- Reskin `CoverageMap` (hex) + `CountyCoverageMap` (county): Survey fills at ~.9 opacity, `--warn` dashed hatch for gaps, caption plates (blurred surface, like the mockups' fixed `.mapcap`), `contrastText()` retained (F-19/F-1 fix folds in).
- The mockups' simplified dissolved-state geometry is **mockup-only**; the app keeps its real `us-counties.json` + hexgrid.
**Acceptance:** both maps in both themes; keyboard/companion-list item from R3 WS-8 honored.

### WP-E — Pages = REDESIGN-R3 WS-2..8, visual spec = mockups
Execute the R3 page workstreams in order, each using its mockup as the visual target:
| R3 WS | Mockup spec | Notes |
|---|---|---|
| WS-2 Dashboard | `01` | Thesis hero (map + one sentence + 3 KPIs) replaces the stat rail; KPI data from `src/modules/analytics` only (PRN-15) |
| WS-3 Leads | `02` | Keep the page's architecture (audit: best screen); reskin + `LeadDialog` gets the partner-territory map panel |
| WS-4 Unmatched + Imports | `07`, `14` | Funnel cards on import detail; assign modal copy pattern |
| WS-5 Partners | `08` | Territory map scoped to partner + paired given/closed history |
| WS-6 Rules | `13` | Pattern cards with locked-regex chip + enable toggles |
| WS-7 Settings + notifications | `09` | Left-nav IA (rename group collision → "Organization"), notification center, profile menu |
| WS-8 Coverage + Activity + polish | `03`, `15` | Coverage = signature screen; activity timeline |
**Acceptance per page:** R3 §4 functional criteria + visual parity with the mockup + `/audit frontend` on the diff.

### WP-F — PortalShell + portal (was R3-deferred F-25 — now specced)
- New `src/app/portal/layout.tsx` shell per mockups `04`/`05`: top bar + bottom tabs (Leads/Activity/Account), one-lead-per-card, ≥48px contact actions, territory chip, info-blue "New" badge.
**Acceptance:** portal usable at 375px; TST-07 journey still passes; touch targets ≥44px.

### WP-G — Email + export brand surfaces
- Digest/invite templates restyled per mockup `11` (tokens already feed emails via SEAM-08).
- Export group headers/legend take the new partner tints automatically via WP-A; verify `contrastText` on group headers; SEC-06 sanitization untouched. Spec: mockup `12`.

## Verification (program-level)
1. `pnpm check` + full unit/component suites green per WP.
2. Token contrast test enforces the DIRECTION matrix (both themes).
3. `/audit frontend` after WP-C and after WS-8; findings triaged before owner walkthrough.
4. Owner walkthrough per page WS (same format as 2026-07-09), against the corresponding mockup.
5. `pnpm audit:axe` against a served build once pages land (closes the "static-only" gap from the 2026-07-09 audit).

## Open decisions to confirm at session start
1. **Sequencing:** adopt as WS-1.5 before WS-2+ (recommended) — or reskin after R3 finishes (touches every page twice; not recommended).
2. **Warn token:** accept 3.76:1 light-mode `warn` as large-text/signal-only, or darken it.
3. **Fonts:** confirm Fraunces / Hanken Grotesk / IBM Plex Mono (all Google Fonts, `next/font`, no new deps) or name substitutes.
4. **Token naming:** keep existing var names with new values (small diff) vs rename to Survey vocabulary (`--route` etc., larger diff). Recommend keep-names.

## Known mockup↔app deltas (so the implementer isn't surprised)
- Mockup geometry is simplified/dissolved; the app uses its real county data — visual style transfers, geometry does not.
- Partner→state assignments in mockups are demo fiction; real coverage comes from the DB.
- Mockups approximate the three typefaces with system stacks; production loads the real ones.
- Mockup topbars/sidebar badges drift slightly per file; the single `AppShell` resolves this by construction.
