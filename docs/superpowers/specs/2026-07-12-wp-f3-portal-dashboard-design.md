# WP-F.3 — Portal Dashboard (Survey identity)

**Status:** design · **Branch:** phase-2/distribution · **Date:** 2026-07-12
**Inputs:** mockups `04`/`05` (portal), admin dashboard `src/app/dashboard/page.tsx` (WS-2, the
hero to mirror), `docs/design-reinvention/IMPLEMENTATION-PLAN.md` §WP-F.
**Owner calls (2026-07-12):** (1) **no per-lead map and no per-lead "why yours" sentence** — "it's
self-explanatory"; instead (2) **one "Your territory" overview** on a **new portal home** "at the
beginning with some stats, similar to the admin dashboard hero"; (3) placement = a **new
"Dashboard" tab**; (4) hero KPIs = **Leads received · Contacted · Closed · New/untouched**;
(5) territory map shows the partner's **own territory only, everyone else anonymized** (PRN-08).

---

## 1. What this WP is (and is no longer)

WP-F.3 was originally "a single-partner territory map + routing sentence on the portal lead
detail." The owner **dropped both** (self-explanatory; a per-lead map re-opens the unresolved
ZIP-vs-state precision problem). WP-F.3 is now a **portal Dashboard**: a mobile-first hero — a
partner-scoped headline, four KPI tiles, and the partner's own territory on the real coverage map —
mirroring the admin dashboard (WS-2) but scoped to the logged-in partner. The lead-detail page is
**untouched** this WP.

## 2. Non-negotiables that bind this work

- **PRN-08 / privacy:** every query goes through the scope guard; a partner sees **only their own**
  numbers and **only their own** territory. The territory payload never carries another partner's
  name / JV-ref / color (§4.2). No new service-role path.
- **PRN-15:** all statistics come from `src/modules/analytics` — this WP **reuses**
  `partnerPerformanceDetail` (already partner-scoped) and extends its **pure** builder; it does not
  re-derive a number in a route or component.
- **PRN-01:** the stat/territory shaping stays in pure builders (`now` injected).
- **PRN-12 / PRN-14:** tokens only; the partner's swatch always sits with its name + JV-ref.
- **Frontend rules (§6.17):** server data via TanStack Query only; the ~0.9 MB county geometry is
  code-split + client-only (already how `CountyCoverageMap` loads).
- **Auth:** the dashboard is the new **landing**, so it applies the same server-side ToS gate as
  today's `/portal` page (`getServerScope` → `needsTosAcceptance` → redirect) before rendering.

## 3. Navigation change

- Add a **"Dashboard"** tab to `PortalShell` (`src/components/PortalShell.tsx`), **leftmost**, at
  **`/portal/dashboard`**. Bottom tabs become **Dashboard · Leads · Activity · Account** (4).
- The top-bar logo `href` and the post-auth landing repoint from `/portal/leads` →
  `/portal/dashboard`. (Find the post-OTP/ToS redirect target and repoint it; verify no other code
  hard-codes `/portal/leads` as "home".)
- `/portal` stays the **Account** tab (least churn — the working ToS-gate + sign-out flow is not
  disturbed). Account's tab `active` check is unchanged.

## 4. Backend

### 4.1 Partner-scoped stats (reuse + one pure extension)

`partnerPerformanceDetail(scope, partnerId, range)` already returns `{ given, contacted, closed,
avgContactHours }` + history, SQL-scoped to one partner. For the portal, call it with
`partnerId = scope.partnerId`. **The only gap is "New/untouched."** Extend the **pure**
`buildPartnerPerformance` to also return `untouched` = count of facts whose `receivedAt` is in range
**and** `firstTouchAt` is null (a lead given in-range with no partner action yet). Additive field on
`PartnerPerformance.stats`; the admin partner-profile consumer ignores it (backward-compatible).
Requirement-ID test: `ANA-02: untouched counts in-range leads with no first touch`.

New route **`/api/portal/dashboard?range=<RangeKey>`** (mirrors `/api/portal/leads` scoping + Zod
range validation): returns `{ range, stats: { leads, contacted, closed, untouched } }` where
`leads = given`. Scope = the caller's own partner (`scope.partnerId`); a partner with no partnerId
(shouldn't happen in the portal) → 400/empty.

### 4.2 Scoped territory (new pure builder + route)

New pure builder `buildPartnerTerritory(ownStateRules, partner, leadCounts?)` in
`src/modules/coverage/` returning the existing `StateCoverage[]` shape so `CountyCoverageMap`
consumes it unchanged:
- **Owned** states (state_rules where `partnerId = scope.partnerId`) → `{ partnerId, partnerName,
  refId, color }` (the partner's own identity).
- **Every other** state (covered by someone else **or** uncovered — indistinguishable) →
  `{ partnerId: null, partnerName: null, refId: null, color: null, gap: false }`. Anonymized: the
  partner cannot tell which states others cover, matching mockup 05 ("only your territory lit").
- Returns `{ states, ownStateCount, partner: { name, refId, color } }`.

New route **`/api/portal/territory`** (range-independent; scoped): selects the partner's own
`state_rules` + the partner's own record, calls the builder, returns the payload. Client query key
`["portal-territory"]`.

**Map rendering checkpoint:** confirm `CountyCoverageMap` renders a `color: null, gap: false` state
as a plain neutral fill (not the `--warn` gap hatch). If not, add a tiny "neutral" branch — do **not**
show gap hatch in the portal (coverage gaps are an admin concern, and hatch would misread as "your
territory has holes"). Pass `selectedPartnerId = partner.id` so the owned states sit at full opacity
and everything else dims.

## 5. Frontend — the portal Dashboard page

`src/app/portal/dashboard/page.tsx` (server component: ToS gate, then renders a client
`PortalDashboard` body — the `/portal/page.tsx` pattern). Mobile-first, inside `PortalShell`, one
`<main>`.

- **Eyebrow** — the range label. **Range control** — a compact `SegmentedControl<RangeKey>`
  (7d/30d/12mo/all), default **30d** (mirrors admin; drives the stats query). Owner may adjust the
  default at walkthrough.
- **Headline** (Fraunces) — partner-scoped, e.g. *"**N** leads across your **M**-state territory."*
  (N = `leads` in range; M = `ownStateCount`). Empty state: *"No leads in your territory yet."*
- **Four KPI tiles** (reuse the admin `HeroKpi` cell design, tokens): **Leads · Contacted · Closed ·
  New** — each self-labeled with an ANA-03 calc tooltip; tone tint redundant, never color-alone.
- **Territory map** — the lazy `CountyCoverageMap` with the scoped `["portal-territory"]` payload +
  `selectedPartnerId`, a `caption` = the partner's own name + JV-ref (PRN-14), `interactive`
  left default (or `false` for a calm static hero — decide in build; mobile pan/zoom is fine to keep).
- **States:** loading skeleton, error EmptyState (per query), and the empty (no-leads) headline — the
  admin dashboard's state matrix, scaled down.

No new lead actions, no contact info, no per-lead map (owner). Frontend + two scoped reads only.

## 6. Testing (TDD-first; requirement-ID names)

- `buildPartnerPerformance` — `ANA-02: untouched = in-range leads with null first touch` (+ existing
  given/contacted/closed unaffected).
- `buildPartnerTerritory` (pure) — owned states carry name+ref+color; **every non-owned state is
  anonymized** (null name/ref/color) — the PRN-08 assertion; `ownStateCount` correct;
  `PTL/PRN-14: the partner's own swatch pairs with name+ref`.
- Route scoping — `/api/portal/dashboard` + `/api/portal/territory` return only the caller's
  partner's data (integration, mirroring the portal-leads isolation tests, TST-01/08).
- Nav — a render test that `PortalShell` shows the Dashboard tab and marks it current on
  `/portal/dashboard`.
- Full unit suite green **serial**; typecheck separately; lint changed files; integration (local DB).

## 7. Owner walkthrough (before commit)

Real Playwright screenshots at **375px** (mobile) + desktop, both themes, of `/portal/dashboard`
with seeded partner data — the dashboard is an authed page, so render it via a throwaway public
preview route under `src/app/gallery/<name>/` that mounts the real `PortalDashboard` body with mock
query data (or, if simpler, log in as a seeded partner and screenshot directly). Confirm: own
territory lit + others neutral (no competitor names), the four KPIs, headline, and the 4-tab bar.
Delete the throwaway route before committing.

## 8. Self-review & audits (on the diff, before commit)

PLAYBOOK §6 printed. Then `pr-reviewer` + `audit-tenancy` (the partner-scoping of both new routes +
the territory anonymization is the headline risk) + `audit-frontend-arch` (TanStack discipline,
client/server split) + `audit-a11y` (map role="img" + companion, KPI semantics, touch targets ≥44px).

## 9. Out of scope / WP candidates

- The per-lead territory map + ZIP-vs-state precision fix (owner dropped; the ⭐ ZIP-vs-state
  question remains open for the admin matchcard).
- Portal leads-list extras (territory chip, partner eyebrow, true "New/unread" badge — the last
  needs per-lead per-partner viewed-tracking, a schema addition).
- A partner-scoped trend chart / lead-flow line (admin has one; add later if the owner wants depth).
