# TerritoryDesk — Design Direction

**Date:** 2026-07-10 · **Status:** proposed, pending sign-off after Tier-1 mockups.
**Method:** frontend-design two-pass — brainstorm a compact token system, critique it against the generic defaults, then converge on one. This doc is the source of truth every mockup derives color and type from.

---

## The one-line thesis

> **TerritoryDesk is a working atlas.** Leads land on a map, and the product's job is to draw the line from each lead to the partner who covers that ground.

Geography is the product's one genuinely ownable asset. The current app buries it in a secondary "Coverage" page; this direction makes **the plat map and the route line the brand.** Everything else stays quiet so that one idea can be loud.

*("Plat" — a surveyor's map of land divided into parcels — is the internal codename for this direction. The product name stays **TerritoryDesk**.)*

---

## Three candidates, critiqued

### A — "Cartographic Calm" ✅ (converged)
Geography as thesis; territory rendered as an elegant survey plate; a route line from lead to partner as the signature. Cool survey-paper neutrals, petrol ink, one warm marigold accent.

### B — "Dispatch Flow"
Reframe routing as living dispatch (arrive → match → land); identity carried by an animated pipeline. **Folded in, not chosen whole:** its best idea — motion that *expresses routing* — is absorbed as A's signature gesture (the route-line draw). Adopting it wholesale would have made the app feel like a logistics widget and leaned on a generic "electric accent on near-neutral" look (close to AI-default #2).

### C — "Warm Operational Minimal (the Desk)"
A tactile warm workspace; partner identity as filing tabs. **Rejected as the base:** its warm-cream + soft-rounded read drifts straight toward AI-default #1 (cream / serif / terracotta). Its one keepable instinct — *friendly warmth* — is retained through A's marigold accent and generous spacing, without the cream ground.

### Critique against the known AI defaults
The convergence was pressure-tested against the looks a generic tool produces, and deliberately steers off all of them:

| Default look | How this direction avoids it |
|---|---|
| Warm cream + serif + terracotta | Ground is **cool petrol paper**, accent is **marigold not terracotta**, body is **sans not serif** (serif is display-only, used with restraint), data is **mono**. Four of five axes differ. |
| Near-black + lone acid accent | Ground is light-first paper; accent is a **warm, desaturated marigold**, not neon. |
| Broadsheet hairlines + dense columns | Hairlines exist but the layout is map-led and spacious, not newspaper columns. |
| Purple→blue gradient hero | No gradient hero; the hero is a **live map**. There is no purple or indigo anywhere. |
| Inter / Space Grotesk "safe" faces | Body is **Hanken Grotesk**, display is **Fraunces**, data is **IBM Plex Mono** — none of the safe defaults. |
| Emoji markers, everything centered, rounded-lg everything | Structural markers are **coordinates and ref-IDs** (real data), layouts are left-anchored and map-led, radii are **modest and slightly engineered** (4–12px), not uniform pills. |

**The one real aesthetic risk:** marigold-on-petrol with a serif display in a dense B2B ops tool. Ops tools are universally sans + blue/indigo; this is warm, editorial, and cartographic instead. Defensible because it *is* the subject (surveyor's marker + engraved map title + coordinate mono) and it directly fixes the audit's "no voice / no thesis" verdict.

---

## Token system v2

### Color — "Survey"
Cool paper, petrol ink, one marigold signal. Neutrals are biased toward the ink's petrol hue (chosen, not default grey). Semantic colors are **separate from the accent** and used only for state.

**Light**
| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F1F4F3` | app ground (cool survey paper) |
| `--surface` | `#FFFFFF` | cards, panels |
| `--surface-2` | `#E9EEEC` | sunk / hover fills |
| `--surface-3` | `#DDE5E2` | rails, chart plots |
| `--ink` | `#16242B` | primary text, ink strokes |
| `--ink-2` | `#46565D` | secondary text |
| `--ink-3` | `#566268` | tertiary text (AA on paper) |
| `--line` | `#D3DCD9` | hairline borders |
| `--line-strong` | `#B8C4C0` | dividers, table rules |
| `--route` | `#E0912B` | **signature** — route lines, focal fills, primary button |
| `--route-strong` | `#C67D1E` | route hover / active |
| `--route-tint` | `#FAEFDA` | soft marigold wash |
| `--route-ink` | `#8F5416` | amber text/links (AA on paper) |
| `--matched` | `#2C7A57` | success / "matched" confirmations |
| `--info` | `#2E6E93` | info (cartographic "water" blue) |
| `--warn` | `#B9741C` | warnings |
| `--danger` | `#B23A2E` | destructive / errors |

**Dark** (petrol night; same roles, re-valued — not inverted)
`--paper #10181C` · `--surface #17232A` · `--surface-2 #1E2C33` · `--surface-3 #26363E` · `--ink #EAF0EE` · `--ink-2 #A9B8BC` · `--ink-3 #85969B` · `--line #2A3A41` · `--line-strong #3A4D55` · `--route #F0A63E` · `--route-strong #F6B856` · `--route-tint #2A2417` · `--route-ink #F0A63E` · `--matched #4FB183` · `--info #5FA0C8` · `--warn #E0973A` · `--danger #E06555`.

Primary buttons are **marigold fill + petrol-ink text** (a highlighter, not a candy button) — the memorable, non-generic choice; contrast verified AA.

### Type
Three real roles — the fix for the audit's "display face == body face" finding. Base size **16px** (up from the cramped 14px); no chrome text below ~13px.

| Role | Production face (via next/font) | Mockup stack | Where |
|---|---|---|---|
| Display | **Fraunces** (opsz, soft old-style serif) | `ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif` | page titles, headline numbers, the map plate title |
| Body / UI | **Hanken Grotesk** | `system-ui, -apple-system, "Segoe UI", sans-serif` | all running UI text, labels, tables |
| Data / mono | **IBM Plex Mono** | `"SF Mono", "Cascadia Code", ui-monospace, "Roboto Mono", monospace` | ref-IDs, coordinates, counts, ledger numerics |

> Mockups approximate the intended faces with robust system stacks (fonts can't be CDN-linked under the Artifact CSP and full-file base64 embedding is impractical across ~20 files). Production loads the real faces via `next/font`; the *pairing and scale* are what the mockups prove. Ref-IDs and numerics use tabular mono — the "ledger" numerics reimagined as **cartographic coordinates**.

**Scale** (1.2 ratio): 0.813 / 1 / 1.2 / 1.44 / 1.728 / 2.074 / 2.488 rem. Line-height: body 1.55, headings 1.15, data 1.4. Uppercase micro-labels get +0.08em tracking. Headings `text-wrap: balance`.

### Layout
- **Admin = a dense atlas workspace.** Left rail grouped by the weekly job — **Route** (Dashboard, Leads), **Review** (Unmatched, Imports), **Network** (Partners, Coverage), **Admin** (Rules, Activity, Settings). Content opens with a **thesis block** (a live map + one headline sentence), then supporting detail — never a row of equal-weight stat pills.
- **Portal = a focused mobile stack.** A real `PortalShell` top bar; one lead per card; a prominent contact CTA; ≥44px targets; same palette/type, lighter density.
- Tables get a shared formatting system: text left, numerics right (tabular mono), hairline rules, generous rows, slightly squared corners for the "plat/engineered" feel (radii 4–12px, not uniform pills).

### Motion — restrained
Quiet 120–200ms fades throughout; skeleton shimmer on load. **No route-draw / "journey" animation** (removed per owner feedback — see revision below). `prefers-reduced-motion` honored everywhere.

### Signature element  *(revised 2026-07-11)*
**The real US coverage map, colored by partner.** A true county choropleth — dissolved to state level and colored by the partner who covers each region, with uncovered states hatched in amber. It reuses the app's *own* geometry (`public/geo/us-counties.json`), so the mockups match production. This is the one thing the app is remembered by; boldness is spent here. Appears at three scales: full (Coverage), summary (Dashboard hero), single-partner highlight (Lead detail, Partner profile, Portal). The earlier "marigold route line from lead→partner" was cut — the owner found the lead-to-partner "journey" arc gimmicky; the map itself carries the identity.

### Partner-color system (never color alone — carried over as a rule)
Partners draw from a **printed-map region palette** (muted, distinguishable, AA-safe as tint fills): clay `#B4623F`, sage `#6E8B5E`, slate-blue `#5B7A9E`, ochre `#C79A3E`, plum `#8A5A78`, teal `#3E8C8A`, rust `#A65A34`, moss `#57794C`, denim `#47688E`, brick `#9E4B45`. Every use pairs the swatch with **partner name + `JV-###` ref-ID** — on the map as tinted parcels, in tables as a chip. Color is never the sole signal (PRN-14 preserved).

---

## Build log (what's been tried)
- v0: converged on Cartographic Calm; marigold primary button chosen over ink-fill for friendliness; serif display defended against cream-default risk by keeping ground cool + body sans.
- v0 artifacts published for direction sign-off: `TOKENS.html` (style tile), `01-admin-dashboard.html` (thesis screen — map-led hero replaces the equal-weight stat rail), `04-portal-leads-mobile.html` (two-audience split; friendlier mobile register, ≥48px touch targets).
- Checkpoint: owner approved the direction ("Love it — continue"). Built remaining Tier-1 + all Tier-2.
- Final set: 16 published mockups (see `INDEX.html`).

## Verification (2026-07-10)

Screenshots at 1280/375 could not be captured — the local browser preview is unresponsive (known environment blocker). Verification was therefore by source review + the Artifact renderer. Against the plan's five checks:

1. **Renders as Artifact:** ✅ all 16 published; each carries responsive breakpoints (820/960/1080/520px) so admin degrades and portal is mobile-native. Live screenshots ❌ not possible here.
2. **AA contrast, both themes:** ✅ spot-checked the load-bearing pairs — `ink-3`/paper ≈5.3:1 (light) / ≈4.9:1 (dark); `route-ink`/paper ≈6.8:1; ink-on-marigold primary button ≈6.5:1. Production enforcement stays with `tokens.test.ts`'s computed-contrast assertions.
3. **Keyboard focus + reduced-motion:** ✅ every file ships `:focus-visible{outline:2px var(--route-strong)}` on real buttons/links/inputs, and every animated file (`route-line`, skeleton shimmer, drawer) has a `prefers-reduced-motion` collapse.
4. **Coverage vs Part 2 — honest accounting:**
   - Fully mocked (16): dashboard, leads+detail, coverage, unmatched+assign, import detail+void, partner profile, rules, activity, settings (nav + Data&Export + notification center + profile menu), portal my-leads, portal lead-detail, login, system states (empty/loading/error/404), email, export legend, style tile.
   - Represented by pattern, not a dedicated screen (intentional, not dropped): imports **list** (detail shown; list = the leads-table pattern), partners **roster** (profile shown; roster = the table pattern), portal **home/activity/devices/ToS** (shell + card pattern established by the two portal screens), auth **forgot/reset** (login establishes the auth pattern). These are quick follow-ons on the same system if wanted.
5. **No-anchor check:** ✅ zero reuse of the old slate/green "ledger" identity — every screen is marigold-on-petrol "Survey".

## Revision 2026-07-11 — real map, no route line
Owner: *"I'd prefer the map we have in the current design… I don't really like this journey map thing."* Applied across all map screens:
- Replaced the abstract "plat parcels + marigold route arc" with a **real US county choropleth** matching the app's `CountyCoverageMap` — built by dissolving `public/geo/us-counties.json` counties to states (grid-snapped, crack-free), colored by partner, uncovered states hatched. One self-contained script (`mockups/_usmap.js`, ~285 KB geometry) is inlined into each map screen via a build step, so it never bloats the source by hand.
- **Removed every route-line/pin animation.** Screens updated: Coverage, Dashboard, Leads drawer, Partner profile, Portal lead detail, Login (ambient outline), style tile, INDEX thumbnails.
- Copy reframed to national scale (King County → United States; ZIP counts → state counts) where the map is the subject; ZIP-level routing language kept on individual leads (ZIP-match-beats-state-fallback is the real model).
- Theme colors set via inline `style=` on SVG paths (not attributes) for guaranteed light/dark theming.
- ⚠️ Not visually verified — the local browser preview is blocked, so these were validated structurally (geometry parses, real US shapes, no route paths, single injection). Eyeball the republished artifacts.

## Self-review + fixes (2026-07-11)

A fresh-eyes review agent + mechanical checks (contrast math, dead-code scan, script syntax-check) ran over all 17 files; 25 findings, all High/Med and cheap Lows fixed and republished:
- **Critical:** INDEX.html gallery script had an unclosed function (page rendered empty); TOKENS.html theme toggle had a stray `});` — both were artifacts of scripted edits; **every inline script now passes `node --check`.**
- **Data story unified** on the import funnel 512 in → 64 removed → 412 distributed → **36 unmatched / 11 uncovered states** (was a contradictory 18/5-ZIPs cluster); unmatched rows now live in genuinely uncovered states; covered-states count fixed to 39.
- **Route-line remnants purged:** dead CSS/keyframes in 5 files, "draws the line" thesis copy, INDEX "marigold route" lede.
- **Semantics normalized:** Unmatched=warn, New=info (portal was reusing the marigold Distributed tint), toggle on-state=route everywhere, "Routed"→"Distributed".
- **A11y/mobile:** all 9 admin screens now show a menu button when the sidebar hides (≤820–960px); map caption plates get a blurred backdrop; unmatched modal closes on Esc/scrim; dev hint removed from the portal mockup.
- **Contrast matrix (measured):** all checked pairs ≥4.5:1 both themes **except light `warn` on surface = 3.76:1** → warn is signal/large-text only, or darken during implementation (flagged in the plan).
- Deferred to implementation (single components resolve them): per-file topbar-cluster/sidebar-badge drift, gear-icon variant, identical INDEX thumbnails (now varied by mode), 9th-partner roster affordance (added "+3 more" row in 03).

## Implementation path (out of scope for this deliverable)
Adopting the direction = one WP: swap the values in `src/lib/tokens/tokens.ts` + `globals.css` to the "Survey" palette/scale, load the three faces via `next/font`, and re-skin the primitives + shell. The single-source-of-truth architecture is kept, so email + export inherit the new tokens automatically. Verify the result through the existing `/audit frontend` agents.
