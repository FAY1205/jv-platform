# TerritoryDesk — Front-End Design Audit

**Date:** 2026-07-10 · **Lens:** subjective design quality & brand distinctiveness (not token/SC/bundle conformance — that is owned by the `/audit frontend` agents and the 2026-07-09 run).
**Basis:** source review of `src/app`, `src/components`, `src/lib/tokens`, `globals.css`, plus `docs/design-reference/demo-v1.html` as evidence of the *current* state. The dev stack (Next + Supabase + auth + seed) was not booted for live screenshots; nothing below depends on a running app, and the current look is treated only as the baseline we are moving away from.

This audit exists to answer one question: **why doesn't the current front-end feel like a product with a point of view, and what has to change?** It ends in a keep / kill / reinvent table that the new direction is built against.

---

## Verdict in one paragraph

The engineering is ahead of the design. The token architecture, Radix primitives, light/dark plumbing, and accessibility scaffolding are genuinely good and worth keeping. But the *visual identity* is under-designed: it reads as "a competent internal admin panel," not as TerritoryDesk. Three things cause that — (1) **typography has no voice** (one system font doing both display and body at a cramped 14px root, hierarchy carried only by weight, sub-10px chrome text the owner already flagged as hard to read); (2) **the product's one ownable asset — geography — is treated as a widget**, not the thesis; and (3) **the two audiences are served by one flattened surface**, so the daily power-admin and the once-a-week mobile partner get the same thin chrome. The most-seen screen (dashboard) is also the least consistent, forking its own components. The fix is not polish; it is a new direction with an actual center of gravity.

---

## Scoring rubric (0 = absent, 3 = strong)

| Dimension | Score | One-line reason |
|---|---|---|
| Identity & distinctiveness | **1** | "Slate + green admin." Nothing here couldn't be any other B2B dashboard. |
| Typography | **1** | Display face == body face; 14px root; hierarchy is weight-only; sub-10px labels. |
| Color & mood | **2** | Disciplined and calm, but the palette is inherited (slate/green), not chosen for this subject. |
| Layout & IA | **2** | Sensible admin IA; but flat routing, no grouping that reflects the weekly job. |
| Visual hierarchy & focal point | **1** | Every screen opens with a row of equal-weight stat pills — no thesis, no focus. |
| Data-viz quality | **2** | Recharts wrappers are clean and PRN-14-safe; but generic, and only on one screen. |
| Component & state polish | **3** | Core primitives cover all states well; genuine strength. |
| Motion | **1** | Entrance keyframes exist but are decorative; nothing expresses *routing*. |
| Content / copy | **2** | Mostly plain; "Delivered" vs "Distributed" churn, a few system-y labels. |
| Responsive & mobile (portal) | **1** | Portal has no shell, <44px targets, hand-rolled per-page chrome. |
| Cross-surface consistency | **1** | Admin ≠ portal ≠ email ≠ export; four dialects of one brand. |

**Average ≈ 1.5 / 3.** The ceiling is dragged down by identity, typography, hierarchy, and the portal — exactly the axes a reinvention should spend on.

---

## Per-surface findings (design lens)

### Admin — Dashboard (`src/app/dashboard/page.tsx`)
- **No thesis.** Opens with five equal-weight stat pills in a bordered rail. The eye has nowhere to land; nothing says "this is a routing product." This is the single most templated screen in the app.
- **Forks the system.** Defines its *own* local `Stat`, an inline `panel` class, hand-rolled `<table>` markup, and a bespoke-shadow button — instead of the shared `Stat`, `Card`, `Table`, `Button`. The most-viewed screen is the least consistent one.
- Trend line + source donut are fine but generic; they'd look identical in any analytics tool.

### Admin — Leads (`src/app/leads/leads-view.tsx`)
- The **best** screen: real primitives, isolated filter state, keyboard row-open, `PartnerTag` identity. Keep the *structure*; restyle the skin.
- But the "ledger" numerics render in OS monospace, so the signature look varies per machine and mostly reads as "small grey mono."

### Admin — Coverage / territory (`src/app/coverage/page.tsx`, `CoverageMap`, `CountyCoverageMap`)
- **The buried lede.** The product's most distinctive possible surface — a real map of who-covers-where — is a secondary page with hardcoded `rgba()` halos, `rounded-[3px]` dots, and no keyboard path. Geography should be the brand, and here it's an afterthought.

### Admin — Unmatched / Imports / Partners / Rules / Activity
- Functional, consistent-ish, but visually inert: tables and cards with no hierarchy beyond borders. Import detail re-derives its headline stat client-side; partner profile uses a different map treatment than coverage. Nothing wrong enough to fail conformance; nothing right enough to feel designed.

### Admin — Settings
- Left-nav sectioned layout is sound. A `rounded-[10px]` off-scale nav item is the kind of drift that accumulates. Fine bones, no character.

### Partner portal (`src/app/portal/**`)
- **Second-class by construction.** No `PortalShell` (no `layout.tsx`); every page hand-rolls its own `<main>` + a standalone bell. Nav is a 2-col grid of link tiles — a *different navigation paradigm* than admin. Ref-IDs are bare `font-mono text-brand` links, not the admin identity treatment.
- Ships a raw `<input type=checkbox>` and sub-44px touch targets on the one surface most likely to be used on a phone. This is the audience most poorly served.

### Auth (`login`, `forgot`, `reset`)
- Clean, correct, unremarkable. A centered card on a plain ground — the definition of a default. First impression of the brand carries zero identity.

### Non-screen brand surfaces
- **Emails** (Resend) and the **colored Excel export** consume the same tokens but were never *designed* as brand touchpoints — they're the two surfaces a partner actually keeps, and they look like system output.

---

## Cross-cutting problems (the real targets)

1. **Typography has no voice.** `--font-display` and `--font-sans` are the *identical* system stack (`globals.css:57-59`), `html { font-size: 14px }`, and a lot of chrome is `text-[.62rem]`–`text-[.66rem]` (≈8.7–9.2px). Weight and tracking do all the hierarchy work, and the "ledger" mono is whatever the OS ships. **This is the highest-leverage fix in the entire audit.**
2. **The subject is invisible.** Territory, coverage, routing, matching — the vocabulary that makes this product *this* product — appears nowhere in the visual language. The design could be swapped onto a helpdesk or a billing tool with no edits.
3. **One surface for two jobs.** The daily desktop admin and the occasional mobile partner share flattened chrome. Neither the density the admin wants nor the focus the partner needs is expressed.
4. **Four dialects.** Admin, portal, email, and export don't read as one brand. A partner meets the brand across at least three of these.
5. **No focal moment.** Every screen is a grid of equal-weight boxes. There is no hero, no "here's where your lead went and why" — the emotional core of a routing product is never shown.

---

## Keep / Kill / Reinvent

| Verdict | Item | Rationale |
|---|---|---|
| **KEEP** | Token *architecture* (single source `tokens.ts` + `globals.css` → Tailwind/email/export) | Best decision in the codebase; the new palette drops straight into it. |
| **KEEP** | Radix primitives, TanStack Query, Recharts | Solid, headless, restyleable. Reskin, don't replace. |
| **KEEP** | Light/dark plumbing (`data-theme` + `prefers-color-scheme`) | Reuse verbatim with new token values. |
| **KEEP** | A11y scaffolding + "never color alone" partner identity (name + ref-ID + swatch) | Correct and legally load-bearing; carry the *rule* into the new partner-color system. |
| **KEEP** | Leads-page architecture (isolated filters, keyboard rows, code-split dialog) | Restyle the skin, keep the bones. |
| **KILL** | Slate + green "routing ledger" identity | Inherited, not chosen; owner opened the door to full reinvention. |
| **KILL** | System-font display face + 14px root + sub-10px labels | The named readability problem. Replace with a real type pairing and scale. |
| **KILL** | Dashboard's forked Stat/panel/table/button | Rebuild on the shared system with a real thesis. |
| **KILL** | Portal's shell-less, tile-grid navigation | Replace with a proper mobile-first PortalShell. |
| **REINVENT** | Geography / coverage → the brand's signature, not a widget | The one ownable, non-templated asset. Make it the thesis. |
| **REINVENT** | The "matching moment" (lead → why → partner) | Give the product an emotional focal point on lead detail + routing. |
| **REINVENT** | Motion — from decorative entrances → one honest routing gesture | Spend motion where it expresses the product. |
| **REINVENT** | Email + export as designed brand touchpoints | The surfaces partners keep deserve real design. |

---

## What this hands to the direction

The reinvention should: give the product **a typographic voice** (real display + body + utility pairing, a comfortable base size, a scale that fixes readability); make **geography the thesis**; **split the two audiences** into a dense admin and a focused mobile portal that still read as one brand; and land **one signature moment** — the lead-to-partner match — carried through motion. Everything technically strong (tokens, Radix, a11y, "never color alone") is retained and simply re-skinned. Proceed to `DIRECTION.md`.
