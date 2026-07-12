# WP-Q — tiny-helpers bundle Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-12-wp-q-tiny-helpers-design.md`. Three independent helpers, one commit. TDD each pure/render unit.

**Goal:** Extract `statusPillClass` to a pure lib module, add a flexible `LinkCard` primitive, and add a `compact` variant to EmptyState — then route the duplicated sites through them.

## Global Constraints
- PRN-12 tokens only. `cn()` does NOT dedupe classes — never rely on override order for `display`/size.
- Vitest serial. Typecheck + eslint changed files separately. One commit; owner "go" before commit and push.
- Every new/changed primitive gets a `/gallery` card (FRONTEND_STANDARDS §2).

---

### Task 1: `statusPillClass` lib module (TDD)
**Files:** Create `src/lib/status-pill.ts`, `tests/unit/status-pill.test.ts`; Modify `src/components/StatusSelect.tsx`, `src/components/index.ts`, `src/app/portal/leads/page.tsx`.

- [ ] Write `tests/unit/status-pill.test.ts`: `statusPillClass("Closed")` contains `PILL_BASE` tokens + `bg-success-soft text-success`; `statusPillClass("Weird")` → fallback `bg-surface-3 text-text-2`; `statusPillClass("New","ml-auto")` contains `ml-auto`.
- [ ] Run → FAIL (module missing).
- [ ] Create `src/lib/status-pill.ts` (STATUS_PILL map + PILL_BASE + `statusPillClass(status, extra?)` per spec).
- [ ] Run → PASS.
- [ ] `StatusSelect.tsx`: delete local `STATUS_PILL`; `import { statusPillClass } from "@/lib/status-pill"`; trigger className → `cn(statusPillClass(val), "cursor-pointer gap-1 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink disabled:opacity-60")`.
- [ ] `src/components/index.ts`: change the StatusSelect line to `export { StatusSelect, type StatusSelectProps } from "./StatusSelect";` (drop STATUS_PILL).
- [ ] `portal/leads/page.tsx`: replace the `STATUS_PILL` import with `import { statusPillClass } from "@/lib/status-pill"`; pill span className → `statusPillClass(l.status, "ml-auto")`.
- [ ] `pnpm typecheck` clean.

### Task 2: `LinkCard` primitive (TDD)
**Files:** Create `src/components/LinkCard.tsx`; Modify `src/components/index.ts`, `src/app/portal/leads/page.tsx`, `src/app/portal/portal-account.tsx`; Test in `tests/unit/components/link-card.test.tsx`.

- [ ] Write `tests/unit/components/link-card.test.tsx`: renders `<a href>`; base chrome present (`rounded-xl`, `border-border`); merges consumer `className`; base has NO `block`/`flex` (display owned by caller); forwards ref to the anchor.
- [ ] Run → FAIL.
- [ ] Create `src/components/LinkCard.tsx` (forwardRef Link + base chrome, no display; per spec).
- [ ] Barrel-export `LinkCard` + `LinkCardProps` from `src/components/index.ts`.
- [ ] Run → PASS.
- [ ] `portal/leads/page.tsx`: swap the whole-card `<Link>` → `<LinkCard href={…} className="block p-4 shadow-sm">…` (drop the now-duplicated chrome classes; keep `block p-4 shadow-sm`).
- [ ] `portal/portal-account.tsx`: swap each LINKS `<Link>` → `<LinkCard href={l.href} className="flex min-h-[52px] flex-col justify-center px-4 py-2.5">…`.
- [ ] `pnpm typecheck` clean.

### Task 3: EmptyState `compact` variant (TDD)
**Files:** Modify `src/components/EmptyState.tsx`, `src/app/partners/[id]/page.tsx`, `src/app/portal/dashboard/portal-dashboard.tsx`; Test in `tests/unit/components/…` (new `empty-state.test.tsx`).

- [ ] Write `tests/unit/components/empty-state.test.tsx`: `compact` → element with `role="status"` + title text, and NO icon circle even if `icon` passed; non-compact → renders icon + action.
- [ ] Run → FAIL.
- [ ] `EmptyState.tsx`: add `compact?: boolean`; when set, early-return the `role="status"` grid layout (title `text-sm text-text-3` + optional description `text-xs text-text-3`, `cn(..., className)`); leave the existing path.
- [ ] Run → PASS.
- [ ] `partners/[id]/page.tsx:242`: raw div → `<EmptyState compact title="Territory map unavailable." />`.
- [ ] `portal/dashboard/portal-dashboard.tsx:121`: raw div → `<EmptyState compact title="Territory map unavailable." />`.
- [ ] `pnpm typecheck` clean.

### Task 4: Gallery + full verification + audit + walkthrough + commit
- [ ] `src/app/gallery/page.tsx`: add a `LinkCard` Section (a block content card + a label/hint row) and a `compact` EmptyState example. Import LinkCard + EmptyState.
- [ ] `pnpm typecheck` clean; `pnpm exec eslint <changed files>` clean.
- [ ] Full unit suite green serial (`pnpm test:unit -- --no-file-parallelism`).
- [ ] Real readback (throwaway `src/app/gallery/tinyhelpers/` route or the permanent /gallery): LinkCard hover/focus chrome intact; the two map errors render role=status with identical text. Delete throwaway route; stop server; move stray PNGs out.
- [ ] PLAYBOOK §6 checklist printed. Agents: pr-reviewer + audit-design-system + audit-frontend-arch. Verify findings against real code; fold in cheap ones.
- [ ] Owner walkthrough → explicit "go" → one commit `feat(wp-q): tiny-helpers bundle — statusPillClass + LinkCard + compact EmptyState (DSN)`.
- [ ] Push after a separate "go".

## Self-Review
- Coverage: statusPillClass (T1), LinkCard (T2), compact EmptyState (T3), gallery+verify (T4) — all spec sections mapped.
- Types: `statusPillClass(status: string, extra?: string): string`, `LinkCardProps = ComponentPropsWithoutRef<typeof Link>`, `EmptyStateProps.compact?: boolean` — consistent across tasks.
- No display-class conflict (LinkCard base omits display; caller sets block/flex).
