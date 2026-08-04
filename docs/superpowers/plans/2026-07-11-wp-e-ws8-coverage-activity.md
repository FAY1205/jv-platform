# WP-E / WS-8 — Coverage + Activity (Survey reskin, mockups 03/15)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Survey-reskin the admin Coverage and Activity pages: fix the `/coverage` legend swatch to match the map's amber hatch, add the map caption plate, move both page titles to the topbar, and bump sub-13px chrome — keeping Activity as the (best-practice) audit-log table.

**Architecture:** Pure presentational edits to two existing, already-functional pages. Reuses `MapHatch` (WP-D) for exact legend↔map parity and the map's existing `caption` prop for the plate. Title→topbar via the established `usePageHeader` split (as in `PartnersBody`).

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query, Tailwind v4 (semantic tokens), Vitest + Testing Library, Playwright MCP for screenshots.

## Global Constraints

- **PRN-12:** tokens only. The legend hatch reuses `MapHatch` (`--warn`/`--warn-soft`) — no new colors.
- **PRN-14:** uncovered territory is conveyed by TEXTURE (hatch) + the "Uncovered" label, never color alone — the legend must now match the map's hatch, not a flat grey.
- **PRN-15:** server data via TanStack Query only (unchanged).
- **Sub-13px chrome floor (WP-C):** bump touched `.68rem`/`.7rem`/`text-xs` chrome to 13px.
- **Best-practice decision (owner):** Activity stays a sortable/filterable **table** (audit-log convention), not the mockup-15 timeline.
- **Scope (owner):** portal quick-fixes (F-66/F-22/F-20) are DEFERRED to WP-F — not in this WP.
- **No new dependencies.**
- **ONE commit for the whole WP**, AFTER the owner walkthrough. Tasks end at "green", not at a commit.
- **Env/tooling:** unit tests SERIAL (`--no-file-parallelism`); always `pnpm typecheck`; lint CHANGED files.

## Note on tests
This WP is a pure visual reskin of two already-functional, already-tested pages — it introduces **no new logic**, so there are no new unit tests (same as the WS-3/4/5 reskins). Verification = the full serial suite stays green (no regression from the title→topbar refactor), typecheck, lint, and two-theme screenshots. If the h1 removal breaks any existing render test, that test is updated in the same task.

---

## File Structure
- **Modify** `src/app/coverage/page.tsx` — split `CoveragePage → <AppShell><CoverageBody/></AppShell>`; `CoverageBody` moves the title to the topbar, fills the map caption, and swaps the legend swatch to a `MapHatch` SVG; sub-13px bumps.
- **Modify** `src/app/activity/page.tsx` — split into `ActivityBody`; title→topbar; sub-13px cell bumps.

---

## Task 1: Coverage reskin

**Files:**
- Modify: `src/app/coverage/page.tsx`

**Interfaces:**
- Consumes: `usePageHeader` from `@/components`; `MapHatch` from `@/components/map`; the map's existing `caption?: { title; subtitle? }` prop.

- [ ] **Step 1: Rework imports + split the component**

In `src/app/coverage/page.tsx`, extend imports:
```tsx
import { AppShell, CountyCoverageMap, PartnerTag, EmptyState, Skeleton, usePageHeader } from "@/components";
import { MapHatch } from "@/components/map";
```

Replace the `export default function CoveragePage() { ... }` with a thin shell + a body component:

```tsx
export default function CoveragePage() {
  return (
    <AppShell>
      <CoverageBody />
    </AppShell>
  );
}

function CoverageBody() {
  const { data, isPending, error } = useQuery({
    queryKey: ["coverage"],
    queryFn: () => apiGet<CoverageResponse>("/api/coverage"),
  });
  const [selected, setSelected] = React.useState<string | null>(null);
  const toggle = (id: string | null) => setSelected((prev) => (prev === id ? null : id));
  const hatchId = React.useId();

  const actions = React.useMemo(
    () => (
      <Link
        href="/partners"
        className="shrink-0 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text-2 shadow-xs transition-colors hover:border-text-3 hover:bg-surface-2"
      >
        Manage partners →
      </Link>
    ),
    [],
  );
  usePageHeader({ title: "Coverage", actions });

  return (
    <>
      {isPending ? (
        <Skeleton className="h-[460px] rounded-2xl" />
      ) : error ? (
        <div className={panel}>
          <EmptyState title="Couldn't load coverage" description={(error as Error).message} />
        </div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="States covered" value={`${data!.coveredCount}/51`} sub="by a state rule" />
            <StatCard label="ZIP overrides" value={data!.zipCoverageCount} sub="beat the state rule" />
            <StatCard label="Partners with territory" value={data!.partners.length} sub="own states or ZIPs" />
          </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_300px]">
            <section className={panel}>
              <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">County map</h2>
              <CountyCoverageMap
                states={data!.states}
                selectedPartnerId={selected}
                onSelectPartner={toggle}
                caption={{ title: "US coverage", subtitle: `${data!.coveredCount}/51 states · ${data!.zipCoverageCount} ZIP overrides` }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-text-3">
                <span className="inline-flex items-center gap-1.5">
                  {/* Legend swatch reuses the map's amber hatch (MapHatch) — exact parity, texture not color alone (PRN-14). */}
                  <span className="inline-flex h-3.5 w-3.5 overflow-hidden rounded-[3px] border border-border">
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                      <MapHatch id={hatchId} />
                      <rect width="14" height="14" fill={`url(#${hatchId})`} />
                    </svg>
                  </span>
                  Uncovered
                </span>
                <span className="text-text-3">Counties inherit their state&apos;s partner · scroll or use +/− to zoom, drag to pan · click to highlight a partner. Prefer the keyboard? Use the Partners list to highlight and open each territory.</span>
              </div>
            </section>

            <aside className={panel}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Partners</h2>
                {selected && (
                  <Link href={`/partners/${selected}`} className="text-[13px] font-semibold text-brand-ink hover:underline">
                    Open →
                  </Link>
                )}
              </div>
              {data!.partners.length === 0 ? (
                <p className="text-sm text-text-3">No state coverage assigned yet. Add state rules in Rules or ZIP coverage on a partner.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {data!.partners.map((p) => {
                    const on = selected === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggle(p.id)}
                        aria-pressed={on}
                        className={
                          "flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors " +
                          (on ? "bg-brand-soft" : "hover:bg-surface-2")
                        }
                      >
                        <PartnerTag name={p.name} color={p.color} refId={p.refId} size="sm" />
                        <span className="num shrink-0 text-[13px] text-text-3">
                          {p.stateCount} state{p.stateCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Bump the StatCard sub-13px chrome**

In the same file, change the `StatCard` label + sub classes:
- label: `text-xs font-medium text-text-2` → `text-[13px] font-medium text-text-2`
- sub: `mt-1 text-[.68rem] text-text-3` → `mt-1 text-[13px] text-text-3`

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 2: Activity reskin

**Files:**
- Modify: `src/app/activity/page.tsx`

**Interfaces:**
- Consumes: `usePageHeader` from `@/components`.

- [ ] **Step 1: Add usePageHeader to imports + split the component**

In `src/app/activity/page.tsx`, add `usePageHeader` to the `@/components` import list. Rename `export default function ActivityPage()` to `function ActivityBody()`, remove the in-body header block:

```tsx
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Activity</h1>
        <p className="mt-1 text-sm text-text-2">Everything that changed — who did what, and when.</p>
      </div>
```
→ delete it, and instead call `usePageHeader({ title: "Activity" })` near the top of `ActivityBody` (after the state hooks). Remove the `<AppShell>` wrapper from `ActivityBody`'s return (it returns a fragment `<>…</>` starting at the filters `div`), and add a thin default export:

```tsx
export default function ActivityPage() {
  return (
    <AppShell>
      <ActivityBody />
    </AppShell>
  );
}
```

So `ActivityBody` returns:
```tsx
  return (
    <>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {/* …unchanged filter bar… */}
      </div>
      <Card>{/* …unchanged table… */}</Card>
      {data && data.total > 0 && (
        <div className="mt-4"><Pagination …/></div>
      )}
    </>
  );
```

- [ ] **Step 2: Bump the table cells to 13px**

In the table body, change the three sub-13px cells:
- When: `<span className="num text-xs text-text-3">` → `text-[13px]`
- Action: `<span className="num text-xs text-text-2">` → `text-[13px]`
- Item: `<span className="num text-xs text-text-3">` → `text-[13px]`

(The "Who" cell is already `text-sm`; the Type Badge is unchanged.)

- [ ] **Step 3: Typecheck + full serial suite + lint**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green (no regression; if a render test asserted the old in-body `<h1>Coverage>`/`<h1>Activity>`, update it to query the topbar `PageHeaderSlot` instead).

Run: `pnpm exec eslint src/app/coverage/page.tsx src/app/activity/page.tsx`
Expected: no errors.

---

## Task 3: Screenshots · self-review · single commit

**Files:**
- Create (throwaway): `src/app/gallery/coverage-preview/page.tsx`
- Delete before commit.

- [ ] **Step 1: Throwaway two-theme preview route**

Create `src/app/gallery/coverage-preview/page.tsx` rendering the reskinned Coverage body pieces that DON'T need auth/geo: the StatCards, the legend row (with the real `MapHatch` swatch), the `MapCaption` plate, and the companion Partners list — with mock data + a `?t=light|dark` setter. (The full county map needs the ~0.9MB geo + the real `/api/coverage`; the legend swatch + caption + stats + companion list are what changed and can be shown standalone.) Also render a small mock Activity table slice to confirm the 13px cells. DELETE before commit.

- [ ] **Step 2: Dev server + screenshot both themes**

`preview_start` name `"web"`. Via Playwright MCP, screenshot `…/gallery/coverage-preview?t=light|dark`. Verify: the legend "Uncovered" swatch shows the amber diagonal hatch (matching the map), the caption plate renders, StatCards + companion list read at ≥13px, no console errors from our code. (For the live county map itself, spot-check by logging into `/coverage` if a session is available; otherwise the standalone legend/caption parity is the reviewable delta.)

- [ ] **Step 3: Print the PLAYBOOK §6 self-audit checklist** (filled; n/a where inapplicable).

- [ ] **Step 4: Self-review the diff with agents (parallel)**

- `pr-reviewer` — correctness / spec / process; confirm the title→topbar split preserves all coverage/activity behavior (selection, filters, sort, pagination) and no query change.
- `audit-design-system` — token discipline (legend hatch = `MapHatch` reuse), sub-13px floor, theme parity of the hatch swatch + caption.
- `audit-a11y` — legend texture-not-color-alone (PRN-14/1.4.1), map caption is decorative/pointer-events-none, heading hierarchy after the h1→topbar move (one h1), companion-list keyboard path intact.

Address every finding (fix inline or record as deferred). Re-run typecheck + serial suite after fixes.

- [ ] **Step 5: Delete throwaway preview route**

```bash
rm -rf src/app/gallery/coverage-preview
```
Run `pnpm typecheck` again.

- [ ] **Step 6: Owner walkthrough** — present the screenshots (Coverage legend/caption + Activity, both themes). Wait for approval BEFORE committing.

- [ ] **Step 7: ONE commit (after approval)**

```bash
git add src/app/coverage/page.tsx src/app/activity/page.tsx docs/superpowers/plans/2026-07-11-wp-e-ws8-coverage-activity.md
git commit -m "feat(wp-e/ws-8): Coverage + Activity — Survey reskin (legend hatch parity, map caption, title→topbar)"
```

---

## Self-Review (plan vs. brief/decisions)

**Coverage:**
- `/coverage` legend swatch flat-grey→hatch (tracked WP-D follow-up) → Task 1 (MapHatch reuse) ✓
- Map caption plate filled → Task 1 (existing `caption` prop) ✓
- Title→topbar (+ Manage partners action) → Task 1 ✓
- Sub-13px chrome→13px → Tasks 1–2 ✓
**Activity:**
- Kept as table (owner best-practice call), title→topbar, 13px cells → Task 2 ✓
**Already done (verified, not re-touched):** AppShell mobile drawer Esc/focus/inert (F-70), nav grouping (F-63), `Th scope` (F-85), map `contrastText` labels (F-19), coverage companion-list keyboard pattern (F-69).
**Deferred:** portal quick-fixes F-66/F-22/F-20 → WP-F.

**Placeholder scan:** none. **Type consistency:** `CoverageBody`/`ActivityBody` are internal; `usePageHeader({title, actions})` matches the `PartnersBody` precedent; `caption` matches `MapCaptionProps`.
