# WP-E / WS-4 Unmatched + Imports — Survey reskin + import-detail funnel — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`).

**Goal:** Adopt the Survey identity into the three WS-4 surfaces (mockups 07 + 14): the **Unmatched** inbox, the **Imports** list, and the **Import detail** page. All three already meet R3 §4 functionally (server-paginated unmatched table F-11, id-only assign modal F-80, server-summary Distributed stat F-75, void-modal-names-the-run F-65). This is a reskin + the import-detail **funnel** (mockup 14's signature) + carried items (imports CTA repoint off `text-white`, sub-13px bumps, list-page titles → topbar).

**Architecture:** No data-layer change. The import-detail summary rail (5 `Stat` cards + composition bars) becomes a 4-step **funnel** (Imported → Removed → Distributed → Unmatched) fed by the same server `summary` numbers (PRN-15). List pages (Unmatched, Imports) move their title to the topbar `PageHeader` (split into a `*Body` child inside `AppShell`, per the dashboard/leads pattern). Detail pages keep an in-body header (back-link + status + actions) — reskinned. The Unmatched gap map stays the lightweight hex `CoverageMap` (purpose-built warn-ring gap view; not the partner-territory hex the owner rejected — flagged for owner).

**Tech Stack:** Next.js App Router (client), TanStack Query, Tailwind tokens, Vitest, existing `src/components`.

## Global Constraints
- PRN-12 tokens only (no hex/`text-white`); `--brand-contrast` on marigold fills. PRN-14 PartnerTag = swatch+name+JV-###. PRN-15 numbers from the server summary/analytics — the funnel re-derives nothing new (`distributed = Σ summary.perPartner.count`, already in the page). No sub-13px chrome in touched files (bump `.65–.7rem` → `text-[.8125rem]`).
- ONE commit for the workstream. Internal tasks end at green tests; final task = self-audit + reviews + owner walkthrough (Playwright screenshots, both themes) → STOP for sign-off (owner remote), then one commit.
- vitest SERIAL (`--no-file-parallelism`); typecheck separately; lint the CHANGED files.

## Decisions (owner away — flag at walkthrough)
1. **Hex gap-map kept on Unmatched** — it renders warn-ring gaps (its purpose), unlike the partner-territory county map; switching would lose the gap rings + add 0.9MB. Flag for the owner's map-consistency call.
2. **List titles → topbar; detail header stays in-body.** Clean rule: overview/list pages carry their title in the topbar; detail pages (import detail) keep a rich in-body header (back-link + status + actions).
3. **Assign-modal copy stays accurate** — the app's assign is a one-lead manual overlay (PRN-05), NOT a ZIP coverage rule; do NOT adopt the mockup's "routes every future lead in this ZIP" claim. Add location context (ref · ZIP · city) to the header only. (Related to the owner's deferred state/ZIP item.)
4. **Unmatched table: swap "Received" → "Waiting"** (age since received — the useful inbox signal, ASN-03), via a small pure formatter. Skip the mockup's redundant per-row "No coverage" reason column (every row is identical).

## File Structure
- **Create** `src/lib/waiting.ts` — pure `formatWaiting(receivedISO, nowMs)` → "4.2d"/"3h".
- **Create** `tests/unit/waiting.test.ts`.
- **Modify** `src/app/unmatched/page.tsx` — title→topbar (split `UnmatchedInner`→body under AppShell); Received→Waiting column; assign-modal header location context; 13px bumps.
- **Modify** `src/app/imports/page.tsx` — title→topbar (split); CTA repoint; 13px.
- **Modify** `src/app/imports/[ref]/page.tsx` — funnel replaces the 5-Stat rail; void-modal copy per mockup 14; 13px bumps.

---

## Task 1: `formatWaiting` helper

**Files:** Create `src/lib/waiting.ts`; Test `tests/unit/waiting.test.ts`.

**Produces:** `formatWaiting(receivedISO: string, nowMs: number): string` — elapsed time since `receivedISO`; `<48h` → `"Nh"`, else `"Nd"` (one decimal), like `formatContactTime`. `now` injected (pure, no `Date.now()`).

- [ ] **Step 1: Failing test** — `tests/unit/waiting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatWaiting } from "@/lib/waiting";

const now = Date.UTC(2026, 6, 11, 0, 0, 0); // 2026-07-11T00:00:00Z
describe("formatWaiting (ASN-03)", () => {
  it("ASN-03: sub-48h shows hours", () => {
    expect(formatWaiting(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h");
  });
  it("ASN-03: 48h+ shows days to one decimal", () => {
    expect(formatWaiting(new Date(now - 4.2 * 86_400_000).toISOString(), now)).toBe("4.2d");
  });
  it("ASN-03: exactly 48h flips to days", () => {
    expect(formatWaiting(new Date(now - 48 * 3_600_000).toISOString(), now)).toBe("2d");
  });
});
```

- [ ] **Step 2: Run — FAIL.** `pnpm exec vitest run tests/unit/waiting.test.ts --no-file-parallelism` → module not found.

- [ ] **Step 3: Implement** — `src/lib/waiting.ts`:

```ts
// ASN-03: how long an unmatched lead has waited. PURE — `now` is injected, never read
// (mirrors the analytics discipline). Hours under 2 days, otherwise days, one decimal.
export function formatWaiting(receivedISO: string, nowMs: number): string {
  const hours = Math.max(0, (nowMs - new Date(receivedISO).getTime()) / 3_600_000);
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}
```

- [ ] **Step 4: Run — PASS.** Same command → 3 pass.
- [ ] **Step 5: Typecheck.** `pnpm typecheck` → 0.

---

## Task 2: Unmatched reskin (title→topbar, Waiting column, assign header, 13px)

**Files:** Modify `src/app/unmatched/page.tsx`.

- [ ] **Step 1: Add `usePageHeader` + `formatWaiting` imports.** Add `usePageHeader` to the `@/components` import; add `import { formatWaiting } from "@/lib/waiting";`.

- [ ] **Step 2: Split for the topbar title.** Replace the `UnmatchedInner` header + wrapper so the title lives in the topbar:
  - `UnmatchedPage` wraps `<ToastProvider><UnmatchedInner/></ToastProvider>` (unchanged).
  - In `UnmatchedInner`, the outer element is already `<AppShell>` — but `usePageHeader` must run inside it. Since `UnmatchedInner` itself renders `<AppShell>…</AppShell>` (it's the parent), split: rename the current `UnmatchedInner` body into `UnmatchedBody` (calls `usePageHeader({ title: "Unmatched" })`, returns the content WITHOUT `<AppShell>` and WITHOUT the in-body `<div className="mb-6"><h1>…`), and make `UnmatchedInner` return `<AppShell><UnmatchedBody/></AppShell>`. Remove the in-body `<h1>Unmatched</h1>` + subtitle block.

- [ ] **Step 3: Swap Received → Waiting.** In the table header, change `<Th align="right">Received</Th>` → `<Th align="right">Waiting</Th>`. In the row, replace the Received cell:
```
- <Td align="right"><span className="num text-xs text-text-3 tabular-nums">{new Date(l.receivedAt).toLocaleDateString()}</span></Td>
+ <Td align="right"><span className="num tabular-nums text-text-2">{formatWaiting(l.receivedAt, Date.now())}</span></Td>
```
(This cell is in a client component render — `Date.now()` is acceptable here; the formatter itself is pure.)

- [ ] **Step 4: Assign-modal header location context.** In `AssignModal`, thread the lead's `zip`/`city`/`state` (available on `LeadRow`) so the dialog title reads `Assign {refId}` with a mono sub-line `ZIP {zip} · {city}, {state}`. Change `AssignModal`'s props to `{ refId, zip, city, state, onClose }` and the caller `setAssigningRef` to store the full row (or look it up from `listQ.data`). Keep the existing accurate body copy (PRN-05 note) — do NOT add a "future leads in this ZIP" claim. (If threading the row is heavy, minimally: keep `Assign {refId}` and leave the body as-is; the location sub-line is a nice-to-have, not required.)

- [ ] **Step 5: 13px bumps.** `text-[.7rem]` (map caption line ~145) → `text-[.8125rem]`; the per-state chip + stats `text-xs`/`text-[.95rem]` heading are ≥12–15px — bump any `<13px` chrome to `text-[.8125rem]`. The assign-modal `text-xs text-text-3` note → `text-[.8125rem]`.

- [ ] **Step 6: Typecheck + lint.** `pnpm typecheck` (→0); `pnpm exec eslint src/app/unmatched/page.tsx` (→0).

---

## Task 3: Imports list reskin (title→topbar, CTA repoint, 13px)

**Files:** Modify `src/app/imports/page.tsx`.

- [ ] **Step 1: Split for the topbar title.** `ImportsIndexPage` renders `<AppShell><ImportsBody/></AppShell>`; `ImportsBody` calls `usePageHeader({ title: "Imports" })` and returns the content minus the in-body `<h1>Imports</h1>`/subtitle. Keep the "New import" CTA — move it to the topbar `actions` (via `usePageHeader({ title, actions })`) OR keep it as a right-aligned body action. Recommend: topbar `actions` (WP-B one-cluster intent), memoized (constant → no memo needed, it's static). Add `usePageHeader` to the import.

- [ ] **Step 2: CTA repoint.** The "New import" link uses `bg-brand … text-white` — change to the primary token pattern:
```
- className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
+ className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-brand px-3.5 py-2 text-sm font-semibold text-brand-contrast shadow-xs transition-colors hover:bg-brand-strong active:scale-[.98]"
```

- [ ] **Step 3: Typecheck + lint.** `pnpm typecheck`; `pnpm exec eslint src/app/imports/page.tsx`.

---

## Task 4: Import detail — funnel + void-modal copy + 13px

**Files:** Modify `src/app/imports/[ref]/page.tsx`.

**Interfaces — Consumes:** existing `RunDetail` (`upload.rowCount`, `summary.{total,removed,unmatched,previouslyMatched,perPartner}`, `distribution`).

- [ ] **Step 1: Add a `Funnel` (inline in this file).** Above `RunView` (or as a local component):

```tsx
function Funnel({ steps }: { steps: { v: number; label: string; desc: string; tone: "neutral" | "warn" | "brand" }[] }) {
  const toneCls = { neutral: "text-text", warn: "text-warn", brand: "text-brand-ink" } as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {steps.map((s, i) => (
        <div key={s.label} className="relative rounded-2xl border border-border-soft bg-surface p-4 shadow-sm">
          <div className={`font-display text-2xl font-semibold leading-none tabular-nums ${toneCls[s.tone]}`}>{s.v.toLocaleString()}</div>
          <div className="mt-1.5 text-[.8125rem] font-semibold uppercase tracking-[.05em] text-text-3">{s.label}</div>
          <div className="mt-0.5 text-[.8125rem] text-text-3">{s.desc}</div>
          {i < steps.length - 1 && (
            <span aria-hidden="true" className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-text-3 sm:block">→</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Replace the 5-`Stat` grid with the funnel.** In `RunView`, replace the `<Card className="mb-6"><CardBody><div className="grid …5 Stats…">…</div>` opening (the Stat grid only — keep the Distribution + "How leads routed" bars below it) with:

```tsx
      <Funnel
        steps={[
          { v: upload.rowCount ?? leads.length, label: "Imported", desc: "rows read", tone: "neutral" },
          { v: summary.removed, label: "Removed", desc: "by MLS rules", tone: "warn" },
          { v: distributed, label: "Distributed", desc: `to ${distribution.length} ${distribution.length === 1 ? "partner" : "partners"}`, tone: "brand" },
          { v: summary.unmatched, label: "Unmatched", desc: "no coverage", tone: "warn" },
        ]}
      />
      {summary.previouslyMatched > 0 && (
        <p className="mt-3 text-[.8125rem] text-text-3">
          <span className="num font-semibold text-text-2">{summary.previouslyMatched}</span> previously matched (excluded from distribution).
        </p>
      )}
```
Then keep the Distribution bar + "How leads routed" composition inside their own `<Card className="mb-6"><CardBody>…</CardBody></Card>` (move those two blocks out of the old summary card into a new card, or leave them as a card below the funnel). The funnel sits ABOVE that card. Remove the now-unused `Stat` import if nothing else uses it (check — it's only the 5 stats).

- [ ] **Step 3: Void-modal copy (mockup 14).** Update the void `<Dialog>` body to name the run + the recall count:
```
- <p className="mb-3 text-sm text-text-2">Voiding <span className="num font-semibold text-text">{upload.refId}</span> ({upload.filename}) excludes its leads from future dedupe, analytics and exports. It stays in history as voided.</p>
+ <p className="mb-3 text-sm text-text-2">Voiding <span className="num font-semibold text-text">{upload.refId}</span> ({upload.filename}) recalls its <span className="num font-semibold text-text">{distributed}</span> distributed lead{distributed === 1 ? "" : "s"} from partners and excludes every lead in this import from future dedupe, analytics and exports. Past assignments stay on record — this can&apos;t be undone.</p>
```

- [ ] **Step 4: 13px bumps.** `text-[.68rem]` (Distribution / How-leads-routed headings, lines ~163,182) → `text-[.8125rem]`; `text-[.7rem]` (prev-matched pill, ~340) → `text-[.8125rem]`; `text-xs` sub-labels in the composition legend + card headers stay 12px only if ≥12 — bump any `<13px` to `text-[.8125rem]`.

- [ ] **Step 5: Typecheck + lint.** `pnpm typecheck`; `pnpm exec eslint "src/app/imports/[ref]/page.tsx"`.

---

## Task 5: Verify, self-audit, reviews, walkthrough (STOP — owner remote)

- [ ] **Step 1: Gate.** `pnpm typecheck` · eslint changed files · `pnpm test:unit -- --no-file-parallelism` (green — +3 `formatWaiting`). No SQL touched → integration unaffected.
- [ ] **Step 2: Playwright screenshots (both themes).** `/unmatched`, `/imports`, `/imports/[ref]` are auth-gated → throwaway public preview route(s) under `src/app/gallery/` rendering the reskinned pieces (the funnel, the reskinned unmatched table/stats) with mock data; screenshot `?t=light|dark`; delete the route(s).
- [ ] **Step 3: PLAYBOOK §6 self-audit** printed.
- [ ] **Step 4: pr-reviewer + /audit frontend** on the diff; address findings; re-gate.
- [ ] **Step 5: OWNER WALKTHROUGH — STOP.** Post screenshots + summary + the flagged decisions (hex gap-map, detail-header-in-body, assign-copy-accuracy, Waiting column). Do NOT commit until sign-off; then one WS-4 commit (local).

## Review outcomes (audit-frontend-arch; pr-reviewer pending)
FIXED:
- **arch F-1 (High):** the void-import mutation now invalidates `["leads"]`/`["dashboard"]`/`["coverage"]`/`["unmatched"]`/`["unmatched-stats"]` (voiding recalls distributed leads — was a stale-aggregate bug, same class as WS-3's coverage fix; the sibling assign flow already did this).
- **arch F-2 (Medium, FEP-06):** `RunView`'s lead-derived views (delivered/removed/unmatched filters + `buildAnalytics` + partner grouping) wrapped in `useMemo([leads, partners, summary, upload.refId])` — typing a void reason no longer re-analyzes the whole import.

FIXED (pr-reviewer):
- **pr F-1 (High) — void-copy accuracy:** my new void-modal copy (copied from mockup 14) claimed voiding "recalls its N distributed leads from partners" — but `voidUpload` (`src/modules/run/void.ts`) ONLY flags the upload row + excludes it from future dedupe; it never touches leads, never unassigns, and partners keep full access (`listPartnerLeads` has no voided filter). Rewrote the copy to be truthful: void excludes from dedupe/analytics/exports + marks voided; it does NOT recall delivered leads — they keep their assignment and stay visible; reassign/notify separately. **⭐ OWNER PRODUCT FLAG:** if you WANT "void" to actually recall/hide delivered leads from partners, that's a real feature (add a voided-aware filter to `leadWhere`/`listPartnerLeads` or an unassign step in `voidUpload` + tests) — flag/decide.
- **pr F-2 (Low):** the import-detail loading skeleton was updated from the old 5-stat grid to the 4-block funnel shape (no CLS blip).

DEFERRED: pr F-3 (finish the 13px chrome sweep across leads/unmatched/dashboard — pre-existing app-wide `text-xs`/12px pattern, its own WP). arch F-3 (migrate the hand-rolled void/assign fetches to `apiMutate` — pre-existing systemic pattern across many files; do as one "migrate to apiMutate" WP). arch F-4 (move the import-detail refId into the topbar — this WP deliberately keeps DETAIL-page headers in-body with the back-link + actions; consistency note for the owner, WP candidate). arch F-5 (make the `matchMethod` label ternary exhaustive — pre-existing GroupRows code, "none" unreachable for delivered rows).

## Self-Review
- Spec: funnel (R3 §4 "funnel cards on import detail") → Task 4. Assign modal id-only + copy → Task 2 (kept accurate). Imports CTA repoint → Task 3. Title→topbar consistency → Tasks 2–3. 13px sweep in touched files → all tasks. ✅
- Placeholders: none. Types: `formatWaiting` signature consistent; `Funnel` steps typed; `summary`/`distribution` fields match the current file's usage.
- **Flag:** the funnel's Imported total (`upload.rowCount`) vs Removed+Distributed+Unmatched+PreviouslyMatched may not sum exactly (dedupe drops, previously-matched overlap) — the funnel is a stage view, not a strict conservation; confirm the copy doesn't imply exact arithmetic.
