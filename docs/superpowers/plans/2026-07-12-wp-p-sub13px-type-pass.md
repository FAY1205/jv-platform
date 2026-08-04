# WP-P — sub-13px type pass Implementation Plan

> Small mechanical slice; spec `docs/superpowers/specs/2026-07-12-wp-p-sub13px-type-pass-design.md` carries the exact sites. TDD via the source-scanning guard.

**Goal:** Snap the 4 readable sub-12px font-size literals to `text-step-0`; formalize the 2 glyph-fit carve-outs; guard the 4 resolved spellings against regression.

## Global Constraints
- Ladder floor `text-step-0` = 12px (0.75rem), font-size-only (no line-height companion) — globals.css.
- PRN-12 token discipline. Vitest serial. Typecheck + eslint changed files separately.
- One commit; owner "go" before commit and push.

---

### Task 1: Guard first (TDD) — ban the 4 resolved spellings
- [ ] Add `text-[.62rem]`, `text-[0.62rem]`, `text-[.66rem]`, `text-[0.66rem]`, `text-[.7rem]`, `text-[0.7rem]` to `BANNED` in `tests/unit/type-scale.test.ts`; update the header comment (4 resolved in B2; `.6rem` badge + `fontSize:11` SVG remain as glyph-fit carve-outs). Do NOT ban `text-[.6rem]`.
- [ ] Run `pnpm exec vitest run tests/unit/type-scale.test.ts --no-file-parallelism` → **FAIL** (PartnerTag/NotificationBell/CoverageMap/gallery still contain the literals).

### Task 2: Resolve the 4 readable sites → text-step-0
- [ ] `src/components/PartnerTag.tsx:32` — `text-[.66rem]` → `text-step-0`; delete the DSN-11 gap comment above it.
- [ ] `src/components/NotificationBell.tsx:137` — `text-[.62rem]` → `text-step-0`; delete the gap comment above it.
- [ ] `src/components/CoverageMap.tsx:118` — `text-[.7rem]` → `text-step-0`; delete the gap comment above it.
- [ ] `src/app/gallery/page.tsx:186` — `text-[.66rem]` → `text-step-0`.
- [ ] Run the guard → **PASS**.

### Task 3: Formalize the 2 glyph-fit carve-outs
- [ ] `src/components/NotificationBell.tsx:105` — keep `text-[.6rem]`; rewrite the comment to name it a glyph-fit carve-out (fits the 16px badge; excluded from the ladder per FRONTEND_STANDARDS §2).
- [ ] `src/components/CoverageMap.tsx:81` — keep `fontSize: 11`; comment it as a glyph-fit SVG on-polygon label carve-out.
- [ ] `docs/FRONTEND_STANDARDS.md` §2 — add the ladder + glyph-fit exemption bullet.

### Task 4: Verify + audit + walkthrough + commit
- [ ] `pnpm typecheck` clean; `pnpm exec eslint <changed files>` clean; full unit suite green serial.
- [ ] Computed-style readback: PartnerTag refId = 12px; bell badge count does not overflow its circle (throwaway route or /gallery).
- [ ] PLAYBOOK §6 checklist printed; pr-reviewer + audit-design-system on the diff.
- [ ] Owner walkthrough → explicit "go" → one commit `feat(wp-p): sub-13px type pass — snap 4 readable sites to text-step-0, carve out 2 glyph-fit (DSN-11)`.
- [ ] Push after a separate "go".
