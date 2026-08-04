# WP-K — DSN-11 type-scale token family + arbitrary-literal sweep (design)

**Date:** 2026-07-12 · **Status:** proposed, pending owner review · **Depends:** WP-A (tokens/`@theme` wiring) — committed.
**Inputs:** the DSN-11 finding (`docs/audit/2026-07-11-frontend-wpc.md:23` — "map steps → `text-step-*`"), the DSN-11 rule (`docs/audit/2026-07-09-full.md:203` — undocumented Tailwind arbitrary values are findings), `src/app/globals.css` (`@theme`), the repo-wide `text-[…]` literal inventory.
**Menu:** app-wide cleanup **slice A**. **Scope:** the type-scale token family + a mechanical sweep of the arbitrary `text-[…]` **size** literals. No component behavior, no layout, no color, no page structure changes.

## 1. Context — the app has three overlapping type scales

Verified against real code (not the design docs, which describe an aspirational state that was never fully implemented):

- **Tailwind defaults** (`text-xs` 12 / `text-sm` 14 / `text-base` 16 / `text-lg` 18 / `text-2xl` 24 / `text-3xl` 30) — **281 uses / 77 files.** This is the *dominant* scale: `Table` body, `Button`, all form inputs, page `h1`s, `Stat` values. The de-facto body size is **14px** (`text-sm`) and the de-facto label size is **12px** (`text-xs`) — not the "16px base / 13px floor" the DIRECTION describes.
- **Arbitrary `text-[…]` literals** — ~30 uses of `text-[13px]` / `text-[.8125rem]` / `text-[.95rem]` / `text-[2rem]` (+ 5 sub-13px). These were sprinkled onto *some* touched elements as ad-hoc floor-bumps; they are the DSN-11 findings.
- **A dead `--step-*` CSS-var ladder** (`globals.css:66–73`, 1.2 ratio) — defined in `:root` only, **never wired into `@theme`, referenced nowhere.** It generates no utilities. WP-K removes it.

DSN-11's own rule is *not* "zero arbitrary values" — it is "any Tailwind arbitrary value outside `src/lib/tokens` requires an inline comment citing the token gap." WP-K discharges the finding by giving the recurring arbitrary sizes named steps and sweeping the literals onto them.

## 2. Confirmed decisions (owner, 2026-07-12)

1. **Slice A (DSN-11 type scale)** is the next cleanup slice.
2. **Full ladder, numeric, non-negative** — a `text-step-*` family (fixes the ugly `--step--1` "negative step" name). Not role-named.
3. **Sweep reach = arbitrary literals only.** Define the ladder now; this slice sweeps only the ~30 arbitrary `text-[…]` literals. The 281 Tailwind-default utilities stay for a **later, separate slice** (their consolidation is its own design decision). **Zero visual change** is the constraint for this slice.
4. **`.95rem` (15.2px) sites → snap to `text-step-3` (16px).** ~10 card-heading + brand-wordmark sites grow 0.8px (sub-pixel, imperceptible); removes the accidental "heading smaller than body" size and keeps the ladder clean. This is the one deliberate, owner-approved deviation from strict zero-change.

**Stated-and-unobjected decisions** (I raised these as "react if you disagree"; no objection):
- **No bundled line-heights** on the steps.
- **Sub-13px leftovers out of scope** → slices B/D; add the token-gap comment now.
- **No `tokens.ts` mirror**; add a small regression-guard test instead.

## 3. The ladder (defined in `@theme`)

Tailwind v4 `--text-*` namespace → `text-<name>` font-size utilities. Values match current pixel sizes at the 16px root. **Each step is font-size only — no `--text-step-N--line-height` companion** — so a swept element keeps whatever line-height it has today (element `line-height` from the global `h1..h4` rule, or an explicit `leading-*` class). This is what makes the rename a true no-op; it is also why we do *not* reuse the Tailwind default `text-base` for the `.95rem` headings (that utility bundles `line-height: 1.5rem`, which would override the `h2`/`h3` `line-height: 1.15` and shift layout).

| utility | value | role | swept **this** slice |
|---|---|---|---|
| `text-step-0` | `0.75rem` (12px) | micro (= `text-xs` value) | no — vocabulary only |
| **`text-step-1`** | **`0.8125rem`** (13px) | chrome floor: labels, meta, dense/secondary text | ✅ the `text-[13px]` + `text-[.8125rem]` cluster |
| `text-step-2` | `0.875rem` (14px) | body-sm (= `text-sm` value) | no — vocabulary only |
| **`text-step-3`** | **`1rem`** (16px) | base/body; small card headings | ✅ the `text-[.95rem]` sites (snapped +0.8px) |
| `text-step-4` | `1.125rem` (18px) | (= `text-lg` value) | no — vocabulary only |
| `text-step-5` | `1.5rem` (24px) | (= `text-2xl` value) | no — vocabulary only |
| `text-step-6` | `1.875rem` (30px) | (= `text-3xl` value) | no — vocabulary only |
| **`text-step-7`** | **`2rem`** (32px) | hero/display | ✅ the `text-[2rem]` hero |

The un-swept steps (0/2/4/5/6) are **documented vocabulary** for the future default-migration slice. Unused `@theme` values emit no CSS (Tailwind v4 tree-shakes to used utilities), so defining the full ladder is free and makes the later migration a pure rename. They are marked in a comment as "not yet adopted — pending the default-scale migration," and the migration is where any *consolidation* of near-duplicate sizes (12/13/14, 30/32) — a visual decision — is made. WP-K makes no such consolidation.

**Placement:** add a `@theme { --text-step-0 … --text-step-7 }` block to `src/app/globals.css` (alongside the existing `@theme inline` color/radius/shadow/font block — a separate non-`inline` `@theme` block, since sizes are static values, not var indirections). **Delete** the dead `--step--1 … --step-5` vars from `:root`.

## 4. The sweep (mechanical, zero visual change except §2.4)

Replace only the **font-size** utility; leave every other class (`leading-*`, `tracking-*`, `font-*`, `text-<color>`, `uppercase`, `num`, spacing) untouched.

- `text-[13px]` → `text-step-1`
- `text-[.8125rem]` and `text-[0.8125rem]` → `text-step-1`
- `text-[.95rem]` and `text-[0.95rem]` → `text-step-3`
- `text-[2rem]` → `text-step-7` (dashboard hero; keeps its `leading-[1.12]`)

Two `const label13 = "text-[.8125rem]"` definitions (`src/app/dashboard/page.tsx:54`, `src/app/portal/dashboard/portal-dashboard.tsx:28`) become `= "text-step-1"` — one edit each covers all their reuses.

**Authoritative set = re-grep at implementation time** (`text-\[[\d.]+(px|rem)\]`), don't trust this snapshot. Representative touched files (~25): `AppShell`, `PortalShell`, `MapCaption`, `ProfileMenu`, `Table`, `SearchExpand`, `Stat`, `NotificationBell` (its two 13px rows only; its `.6/.62rem` are §5 sub-13px), and pages `activity`, `coverage`, `unmatched`, `partners/[id]`, `dashboard`, `portal/dashboard`, `settings/settings-nav`, `settings/notifications`, `imports/[ref]`, `leads/lead-dialog`, `rules/mls-phrases`, `portal/devices`, `portal/portal-account`, `portal/activity`, `portal/leads`, `portal/leads/[ref]`, `gallery` (its 13px rows only). Note: `PartnerTag` and `CoverageMap` are **not** swept — they carry only sub-13px literals (§5).

## 5. Out of scope (explicit)

- **The 281 Tailwind-default `text-xs/sm/base/lg/2xl/3xl` utilities** — untouched. Their migration onto `text-step-*` (with any size consolidation) is a **separate later slice**, documented as a WP candidate.
- **The 5 sub-13px arbitraries** — `CoverageMap` `.7rem` (117), `PartnerTag` refId `.66rem` (31 → slice **B**), `NotificationBell` badge `.6rem` (104 → slice **D**) + group-label `.62rem` (134 → **B/D**), `gallery` varName `.66rem` (184). WP-K only adds the DSN-11 inline token-gap comment to each so they are rule-compliant; **sizing stays** for the owning slices to decide (bumping them is a layout/visual change entangled with PartnerTag `size=sm` and the touch-target pass).
- No `tokens.ts` changes (sizes have no off-CSS consumer — email/export use `emailFonts` for family only).

## 6. Guardrail — regression-lock test

New `tests/unit/type-scale.test.ts` (DSN-11): scans `src/**/*.{ts,tsx}` and asserts **none** of the swept literal spellings remain — `text-[13px]`, `text-[.8125rem]`, `text-[0.8125rem]`, `text-[.95rem]`, `text-[0.95rem]`, `text-[2rem]`. Reports offending `file:line` on failure. This locks the sweep against re-introduction and survives regardless of lint state (the repo lints changed-files only). It intentionally does **not** flag the 5 sub-13px arbitraries (they carry the documenting comment; they are the tracked gap). Test names carry the ID: `it("DSN-11: no swept text-size literals remain", …)`.

No pure helpers exist to TDD (this is a CSS token + className sweep), so classic red-green TDD does not apply; the guard test is the automated proof, and computed-style readback (§7) is the behavioral proof.

## 7. Verification & process

- **Utility generation is the one real technical risk** — confirm Tailwind v4 emits a working `text-step-1` from `--text-step-1` (numeric multi-segment name). Prove it early via computed-style readback (the established technique): mount probe elements with `text-step-1/3/7`, read `getComputedStyle().fontSize`, assert `13 / 16 / 32 px`. Confirm Tailwind v4 in `package.json`.
- `pnpm typecheck` (separate) + `pnpm exec vitest run tests/unit/type-scale.test.ts --no-file-parallelism` + full unit suite serial.
- `pnpm exec eslint <changed files>` (changed-files only).
- **Real screenshots** (Playwright MCP, both themes): the dashboard hero (`text-step-7`), a page with the 13px cluster + a card heading (e.g. `/coverage` or `/partners/[id]`), to show the sweep is visually inert. Render authed pages via a throwaway `src/app/gallery/<name>/` preview route with mock data + real components; delete before commit; `rm -rf .playwright-mcp`.
- **PLAYBOOK §6 self-audit** printed in the summary.
- **Audit agents on the diff:** `pr-reviewer` (always) + `audit-design-system` (token discipline — mandatory here) + `audit-a11y` (type sizes + the `.95→16` nudge). Not tenancy/data/pipeline (no scoped queries, no migration, no pipeline).
- **Owner walkthrough (screenshots) BEFORE commit.** One commit (WP-K). Explicit "go" before commit and before push, per-action.

## 8. Tier

Tier B (cross-cutting cosmetic sweep, no data/security/pipeline surface, zero behavioral change). No ADR (no new architectural decision — a token family + rename; the `--text-*` `@theme` mechanism is standard Tailwind v4, consistent with the existing `--color-*`/`--radius-*` blocks).

## WP candidates surfaced (do not build here)

- **Default-scale migration** (the big one): migrate the 281 `text-xs/sm/base/lg/2xl/3xl` uses onto `text-step-*`, carrying paired line-heights, with a size-consolidation design pass + full screenshot review. This is the other half of a truly unified type scale.
- Sub-13px sizing decisions belong to slices **B** (PartnerTag `size=sm`) and **D** (touch targets / bell).
