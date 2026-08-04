# WP-C — Primitive re-skin (design)

**Date:** 2026-07-11 · **Status:** proposed, pending owner review · **Depends:** WP-A (tokens), WP-B (shell) — both committed.
**Inputs:** `IMPLEMENTATION-PLAN.md` §WP-C, the component library (`src/components/*`), the `/gallery` page.
**Scope:** the component primitives + `/gallery` only. **No page body** is touched (WP-E). Maps are WP-D.

## 1. Context — WP-A already did most of it

WP-A's token + font swap flowed through every primitive (they consume tokens): `Stat` value is already `font-display` (Fraunces) tabular-nums; `Badge` variants already resolve to Survey token pairs; `Table` already has the partner rail/accent; `EmptyState` already uses `brand-ink`. WP-C is the **targeted remainder** — the AA fixes the marigold value forces, the sub-13px chrome purge in touched primitives, and completing the `/gallery` state matrix.

## 2. Confirmed decisions (owner, 2026-07-11)

> **REVISED DURING BUILD — see ADR-0023.** The TDD anchor falsified both decisions below:
> `--text` flips to near-white in dark (ink-on-marigold = 1.78:1 dark, fails), and
> `--brand-strong` is 2.99:1 on the paper ground (0.01 under 3:1). Owner-approved in-session,
> the shipped result is: marigold-fill text → a new theme-invariant **`--brand-contrast`
> (#20160A)** token; focus rings + the global outline → **`--brand-ink`** (kept at the
> existing width so the muted amber stays subtle). ADR-0023 is the source of truth.

1. ~~**Primary Button / checkbox / marigold-fill text** → the ink token (`text-text`)~~ → **`--brand-contrast`** (ADR-0023).
2. ~~**Focus rings** → `ring-brand-strong`~~ → **`ring-brand-ink`** + global outline `--brand-ink` (ADR-0023).

## 3. Concrete changes

**Button** (`Button.tsx`): `primary` `text-white` → `text-text` (fill `bg-brand`, `hover:bg-brand-strong`, `border-brand` unchanged). `danger`/`secondary`/`ghost` unchanged (white-on-danger = 5.9:1, AA-ok).

**Checkbox** (`Checkbox.tsx`): checked state already `bg-brand` (route on-state ✓); fix the **checkmark** `Indicator` `text-white` → `text-text` (ink on marigold — icon AA); ring `ring-brand/50` → `ring-brand-strong`.

**Focus rings** — `ring-brand/50` | `ring-brand` | `ring-brand-line` → **`ring-brand-strong`** (full opacity) across: `Input` (×2), `Textarea`, `Select`, `NativeSelect`, `StatusSelect` (was `ring-brand-line`), `DatePicker`, `DateRangePicker`, `Checkbox`, `Dialog` (close btn), `RowOpenButton`, `Pagination`, `NotificationBell`, plus the chrome/error pages `settings/appearance`, `global-error`, `not-found`. Paired `focus-visible:border-brand` (DatePicker/DateRangePicker) → `border-brand-strong` for a coherent focus treatment. (This closes the deferred **WP-A F-3**; it finishes the AA cleanup the WP-A value change necessitated — a mechanical class swap, same pattern as WP-A's `text-brand`→`text-brand-ink`.)

**Stat** (`Stat.tsx`): label `text-[.68rem]` → `text-[0.8125rem]`; delta `text-[.7rem]` → `text-[0.8125rem]` (13px floor).

**Table** (`Table.tsx`, `Th`): `text-[.65rem]` → `text-[0.8125rem]`; header rule `border-b border-border` → `border-b border-border-strong` (DIRECTION: line-strong for table rules). `Tr`/`Td` partner accent/rail use the **partner color prop** (DB data) via inline `color-mix`/`borderLeft` — that is dynamic data, not a hardcoded brand hex, so PRN-12-compliant; unchanged.

**Verified token-clean (no change):** `Badge` (variants already Survey pairs), `Toast` (white on dark success/danger, AA-ok), `Dialog`/`EmptyState`/`Tabs`/`Card`/`PartnerTag`/`Skeleton` (tokens only). `Toast` — confirm no `bg-brand text-white` variant exists (it doesn't).

## 4. Gallery state matrix (DSN-03)

Ensure `/gallery` renders each primitive across default / hover / focus-visible / active / disabled / loading where applicable: Button (all variants × sizes + loading + disabled), Badge (all variants), Input/Textarea/Select/NativeSelect/DatePicker/Checkbox (default + disabled + a focus note), Toast (trigger each), Dialog, Skeleton, EmptyState, Table (with a partner-accented row + right-aligned mono numerics), Stat, toggles/checkbox on-state = route. Add any missing states; the gallery already imports the full set. Add `brand-ink`/`border-strong` swatches were done in WP-A.

## 5. Test plan (TDD — write first)

`tests/unit/tokens.test.ts` — add, before the component swaps:
- `contrastRatio(t.text, t.brand) >= 4.5` (both themes) — ink reads on the marigold Button/checkbox.
- `contrastRatio(t.brandStrong, t.surface) >= 3` and `>= 3` on `t.bg` (both themes) — the focus ring meets the 3:1 non-text bar on surface + paper.
These are the WP-C regression anchors (a future token edit can't drop the button text or the focus ring below AA). Component class swaps are then verified by `pnpm check` + the gallery walkthrough; a focused render test is added only where behavior (not just class) changes — none here (all are class/token swaps).

## 6. Out of scope (deferred, labeled)

- **Admin page bodies / per-page rework → WP-E.** The focus-ring class swap does touch three *chrome/error* pages (`settings/appearance`, `global-error`, `not-found`) with a one-token AA fix — not a rework, and not the WS-2..8 content pages — to finish the AA cleanup the WP-A marigold value forced (same rationale as WP-A's cross-page `text-brand-ink` repoint).
- Maps (`CoverageMap`, `CountyCoverageMap`) → **WP-D**.
- The Badge *variant vocabulary* (zip/state vs Distributed/New) is unchanged — renaming would touch page call sites (WP-E); the colors are already correct.

## 7. Audit

Per the plan, run **`/audit frontend`** on the WP-C diff after the build (in addition to the §6 self-audit + pr-reviewer); triage findings before the walkthrough.

## 8. Acceptance / DoD

`pnpm check` core green (typecheck + lint + unit, run serially — no concurrent vitest) · token contrast test green (new ink/brand + brand-strong/surface assertions, both themes) · `/gallery` state matrix complete, no raw hex introduced (PRN-12) · toggles/checkbox on-state = route with AA marks · self-audit §6 printed · pr-reviewer + `/audit frontend` findings addressed · owner gallery walkthrough approved.
