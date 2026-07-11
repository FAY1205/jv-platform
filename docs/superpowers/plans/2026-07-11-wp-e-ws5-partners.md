# WP-E / WS-5 Partners — Survey reskin (roster + profile territory map) — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Checkbox steps.

**Goal:** Adopt the Survey identity into the Partners roster + the partner profile (mockup 08). Both already meet R3 §4 functionally (roster CRUD, per-partner SQL performance, F-10 lean roster). This is a presentational reskin — the one substantive change is swapping the profile's **hex territory map → the real `CountyCoverageMap`** (partner-scoped, static, lazy — the same pattern the owner approved for the WS-3 matchcard).

**Architecture:** No data-layer change. Roster (list page) → title into the topbar `PageHeader` (split `PartnersInner` → `PartnersBody` inside `AppShell`), "New partner" button into the topbar `actions` (memoized). Profile (detail page) → keeps its in-body header (back-link + PartnerTag + status + actions), reskinned; territory map becomes `CountyCoverageMap` (`selectedPartnerId`, `interactive={false}`, lazy via `next/dynamic`, caption); the local `Stat` tooltip affordance goes ⓘ → dotted underline (matching the dashboard); the `.66–.68rem` chrome → 13px.

**Tech Stack:** Next.js App Router (client), TanStack Query, Tailwind tokens, existing components + `CountyCoverageMap`.

## Global Constraints
- PRN-12 tokens (no hex/text-white — none in these files; the `text-white` CTA is in settings/profile = WS-7). PRN-14 PartnerTag unchanged. PRN-15 numbers from the analytics performance API (unchanged). Bump the `.66–.68rem` chrome in touched files to 13px; leave `text-xs` (12px) consistent with the app (a dedicated 13px sweep is its own deferred WP).
- ONE commit; internal tasks end at green; final task = self-audit + reviews + owner walkthrough (Playwright screenshots) → STOP for sign-off (owner remote), then one commit.
- vitest SERIAL; typecheck + eslint changed files.

## Decisions (owner away — flag at walkthrough)
1. **Profile territory map → real CountyCoverageMap** (partner-scoped, static/interactive=false, lazy) — consistent with the WS-3 matchcard the owner approved, and fixes the hex the owner disliked. The roster has no map.
2. **Detail header stays in-body** (profile), consistent with WS-4's import detail.

## File Structure
- **Modify** `src/app/partners/page.tsx` — split `PartnersInner`→`PartnersBody`; title + New-partner action → topbar.
- **Modify** `src/app/partners/[id]/page.tsx` — territory map → CountyCoverageMap (static, lazy); `Stat` ⓘ → dotted underline; 13px bumps.

---

## Task 1: Profile — real territory map + Stat affordance + 13px

**Files:** Modify `src/app/partners/[id]/page.tsx`.

- [ ] **Step 1: Lazy CountyCoverageMap + drop the hex import.** Replace the `CoverageMap` import with a `next/dynamic` `CountyCoverageMap`, and drop the now-unused `US_HEX_STATES` import (the mapStates no longer need the hex grid — but they DO map over US_HEX_STATES to enumerate states; keep US_HEX_STATES for that enumeration OR switch to a plain state-code source). Simplest: keep `US_HEX_STATES` for enumerating the 51 codes; only the RENDER swaps to CountyCoverageMap.
  - Remove `CoverageMap` from the `@/components` import.
  - Add after the imports:
```tsx
const CountyCoverageMap = dynamic(() => import("@/components/CountyCoverageMap").then((m) => m.CountyCoverageMap), {
  ssr: false,
  loading: () => <Skeleton className="aspect-[960/600] w-full rounded-lg" />,
});
```

- [ ] **Step 2: Swap the Territory render.** In the Territory `<section>`, replace `<CoverageMap states={mapStates} selectedPartnerId={partner.id} />` with the static county map + caption, wrapped in an aspect box (no load jump):
```tsx
                  <div className="relative aspect-[960/600] w-full overflow-hidden rounded-lg">
                    <CountyCoverageMap
                      states={mapStates}
                      selectedPartnerId={partner.id}
                      interactive={false}
                      caption={{ title: partner.name, subtitle: `${partner.stateCount} state${partner.stateCount === 1 ? "" : "s"}` }}
                    />
                  </div>
```

- [ ] **Step 3: `Stat` affordance ⓘ → dotted underline + 13px.** Update the local `Stat` component:
```tsx
function Stat({ label, value, sub, tip }: { label: React.ReactNode; value: React.ReactNode; sub?: string; tip?: string }) {
  const inner = <span className="text-xs font-medium text-text-2">{label}</span>;
  const header = tip ? (
    <Tooltip content={tip}>
      <span tabIndex={0} className="inline-flex cursor-help rounded text-xs font-medium text-text-2 underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink">{label}</span>
    </Tooltip>
  ) : inner;
  return (
    <div className={panel}>
      {header}
      <div className="mt-1.5 font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">{value}</div>
      {sub && <div className="mt-1 text-[.8125rem] text-text-3">{sub}</div>}
    </div>
  );
}
```
(Keeps `text-xs` label at 12px — consistent with the app; bumps the `.66rem` sub to 13px; drops the ⓘ glyph.)

- [ ] **Step 4: Territory chips 13px.** `text-[.68rem]` (state chips, ~235) → `text-[.8125rem]`.

- [ ] **Step 5: Typecheck + lint.** `pnpm typecheck`; `pnpm exec eslint "src/app/partners/[id]/page.tsx"`.

---

## Task 2: Roster — title → topbar

**Files:** Modify `src/app/partners/page.tsx`.

- [ ] **Step 1: Add `usePageHeader` + `useMemo`.** Add `usePageHeader` to the `@/components` import; `React.useMemo` is available via the `* as React` import.

- [ ] **Step 2: Split.** `PartnersInner` → returns `<AppShell><PartnersBody/></AppShell>`; `PartnersBody` holds the query + state + the render (minus `<AppShell>` and the in-body `<div className="mb-6">…<h1>Partners</h1>…</div>` header). The "New partner" action moves to the topbar:
```tsx
function PartnersInner() {
  return (
    <AppShell>
      <PartnersBody />
    </AppShell>
  );
}

function PartnersBody() {
  const { data, isPending, error } = useQuery({ queryKey: ["partners"], queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners") });
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Partner | null>(null);
  const [deactivating, setDeactivating] = React.useState<Partner | null>(null);
  const roster = data?.partners ?? [];
  const actions = React.useMemo(
    () => <Button variant="primary" onClick={() => setCreating(true)}>+ New partner</Button>,
    [],
  );
  usePageHeader({ title: "Partners", actions });

  return (
    <>
      <Card>
        …existing table/skeleton/error/empty…
      </Card>
      {creating && <PartnerForm editing={null} onClose={() => setCreating(false)} />}
      {editing && <PartnerForm editing={editing} onClose={() => setEditing(null)} />}
      {deactivating && <DeactivateModal partner={deactivating} roster={roster} onClose={() => setDeactivating(null)} />}
    </>
  );
}
```
(`setCreating` is a stable setter, so `actions` memoized on `[]` is fine.)

- [ ] **Step 3: Typecheck + lint.** `pnpm typecheck`; `pnpm exec eslint src/app/partners/page.tsx`.

---

## Task 3: Verify, self-audit, reviews, walkthrough (STOP — owner remote)
- [ ] **Step 1: Gate.** typecheck · eslint changed · `pnpm test:unit -- --no-file-parallelism` (green — no new tests; presentational). No SQL touched.
- [ ] **Step 2: Playwright screenshots (both themes).** Throwaway public preview under `src/app/gallery/` rendering the profile territory (real static map, partner-scoped) + the reskinned stat cards, with mock partner + a seeded ["coverage"]-style state list; screenshot `?t=light|dark`; delete the route.
- [ ] **Step 3: PLAYBOOK §6 self-audit** printed.
- [ ] **Step 4: pr-reviewer + audit-frontend-arch** on the diff; address findings; re-gate.
- [ ] **Step 5: OWNER WALKTHROUGH — STOP.** Post screenshots + summary + flagged decisions. Commit only after sign-off.

## Review outcomes (pr-reviewer clean; audit-frontend-arch pending)
- **pr F-1 (Medium) — territory-map error state:** ALREADY FIXED (pre-empted) — added a `coverageQ.isError` → `role="status"` "Territory map unavailable." branch (matches the dashboard/matchcard pattern; no more eternal skeleton on a coverage 500).
- pr F-2 (informational, CONFORMS): the `["coverage"]` query fires even for ZIP-only partners (map not rendered) — negligible, shared cache, not gated (extra branching not worth it).
- pr-reviewer also confirmed the `Stat` ⓘ→dotted-underline change is a net a11y IMPROVEMENT (the old `<div>` wrapper had no `tabIndex`, so the Tooltip was never keyboard-reachable — DSN-07 latent bug now fixed).
- No PRN-08/12/13/14/15 issues; typecheck + lint + unit (80/465) green.

FIXED (audit-frontend-arch):
- **arch F-1 (High):** the roster's create/edit + deactivate + invite mutations now invalidate `["coverage"]` (create/edit + owning-partner deactivate) + `["partner", id]` — editing a partner's territory left the profile/dashboard/matchcard coverage maps stale (same class as WS-3/WS-4).
- **arch F-2 (Medium):** the profile range picker swapped from `Select` (+ unsafe `as RangeKey` cast) → `SegmentedControl<RangeKey>` (matches the dashboard; RANGES shortened to "7 days/30 days/…").
DEFERRED: arch F-3 (extend `ApiError` with a details channel + retire the duplicate `send()` helpers in partners/rules — real gap, but its own refactor WP), arch F-4 (RadioGroup primitive — bundle with the tracked Checkbox debt), arch F-5 (TYP-01: derive admin GET client types from shared Zod schemas — pervasive, own WP), arch F-6 (React.memo the profile map — low-confidence, internal memos already bail out).

## Self-Review
- Spec: profile territory map reskin (mockup 08) → Task 1; roster reskin → Task 2. Per-partner given/closed history charts already built (unchanged). No profile CTA repoint (the `text-white` is settings/WS-7). ✅
- Types: `CountyCoverageMap` props match; `mapStates` is `StateCoverage[]`. Roster split preserves all state/queries/modals.
- **Flag:** the profile map now shows the partner's STATE coverage only (ZIP-level coverage isn't state-level) — same state-vs-ZIP caveat as the matchcard; the header already shows the ZIP count. Confirm this reads OK (ties into the owner's deferred state/ZIP item).
