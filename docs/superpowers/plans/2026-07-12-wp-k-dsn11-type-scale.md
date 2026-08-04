# WP-K — DSN-11 type-scale token family + arbitrary-literal sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a named `text-step-*` type-scale ladder to `@theme` and sweep the ~30 arbitrary `text-[…]` size literals onto it, with zero visual change (one sanction: `.95rem`→16px, +0.8px).

**Architecture:** Define the ladder as a plain Tailwind v4 `@theme` block (`--text-step-0…7`), font-size only (no bundled line-heights, so the rename is visually inert). Delete the dead `--step-*` `:root` vars. Sweep the three swept sizes (13/16/32px) across ~25 files. A source-scanning vitest guard locks the sweep; a `/gallery` card documents the ladder and proves utility generation.

**Tech Stack:** Next.js App Router, Tailwind CSS v4 (`@import "tailwindcss"` + `@theme`), vitest (jsdom, serial), Playwright MCP for real screenshots.

**Spec:** `docs/superpowers/specs/2026-07-12-wp-k-dsn11-type-scale-design.md`

## Global Constraints

- **Zero visual change** except the owner-approved `.95rem (15.2px) → text-step-3 (16px)` nudge (~10 sites, +0.8px). Change ONLY the font-size token in a className; leave every other class (`leading-*`, `tracking-*`, `font-*`, `text-<color>`, `uppercase`, `num`, spacing, layout) untouched.
- **PRN-12** — no hardcoded hex/font/product name; consume tokens. The DSN-11 rule: any remaining `text-[…]` arbitrary needs an inline comment citing the token gap.
- **Do NOT touch** the 281 Tailwind-default utilities (`text-xs/sm/base/lg/2xl/3xl`) — separate later slice.
- **Steps are font-size only** — never add a `--text-step-N--line-height` companion.
- **No new dependencies** (guard test uses node `fs` only).
- **Test names carry the ID:** `it("DSN-11: …")`.
- **Commits:** NO per-task commits. Each task ends at a verification checkpoint. The **single WP-K commit is Task 7, gated on explicit owner "go."** Do not push without a second explicit "go."
- **vitest is serial:** `pnpm exec vitest run <file> --no-file-parallelism`; full suite `pnpm test:unit -- --no-file-parallelism`. Always `pnpm typecheck` separately. Lint changed files only: `pnpm exec eslint <files>`.

---

### Task 1: Define the ladder, remove the dead scale, prove utility generation

**Files:**
- Modify: `src/app/globals.css` (add `@theme` type block; delete `--step-*` from `:root`)
- Modify: `src/app/gallery/page.tsx` (add a permanent "Type scale" documentation card)

**Interfaces:**
- Produces: the Tailwind utilities `text-step-0` … `text-step-7` (font-size only). Later tasks consume `text-step-1` (13px), `text-step-3` (16px), `text-step-7` (32px).

- [ ] **Step 1: Confirm Tailwind v4**

Run: `pnpm list tailwindcss` (or `grep '"tailwindcss"' package.json`)
Expected: version `4.x`. If not v4, STOP — the `@theme` mechanism differs.

- [ ] **Step 2: Add the `@theme` type-scale block to `globals.css`**

Insert immediately AFTER the existing `@theme inline { … }` block (after its closing `}`, ~line 198):

```css
/* Type scale (DSN-11, WP-K) — one named ladder consumed via Tailwind
   `text-step-*` utilities (Tailwind v4 `--text-*` namespace). Font-size ONLY:
   no `--text-step-N--line-height` companion, so a swept element keeps its
   element/`leading-*` line-height and the rename stays visually inert.
   Steps 0/2/4/5/6 mirror today's Tailwind-default sizes (text-xs/sm/lg/2xl/3xl)
   as documented vocabulary for the later default-scale migration — not yet
   adopted; unused theme values emit no CSS. */
@theme {
  --text-step-0: 0.75rem;   /* 12px — micro (= text-xs); vocab, not swept */
  --text-step-1: 0.8125rem; /* 13px — chrome floor: labels, meta, dense text */
  --text-step-2: 0.875rem;  /* 14px — body-sm (= text-sm); vocab, not swept */
  --text-step-3: 1rem;      /* 16px — base/body; small card headings */
  --text-step-4: 1.125rem;  /* 18px — (= text-lg); vocab, not swept */
  --text-step-5: 1.5rem;    /* 24px — (= text-2xl); vocab, not swept */
  --text-step-6: 1.875rem;  /* 30px — (= text-3xl); vocab, not swept */
  --text-step-7: 2rem;      /* 32px — hero/display */
}
```

- [ ] **Step 3: Delete the dead `--step-*` scale from `:root`**

Remove these 8 lines from `:root` (currently ~66–73):

```css
  /* Type scale — 1.2 ratio (adopted per-heading as pages are reworked in WP-E). */
  --step--1: 0.813rem;
  --step-0: 1rem;
  --step-1: 1.2rem;
  --step-2: 1.44rem;
  --step-3: 1.728rem;
  --step-4: 2.074rem;
  --step-5: 2.488rem;
```

(Verified unreferenced anywhere — grep `--step-` returns only these definitions.)

- [ ] **Step 4: Add the permanent "Type scale" card to `/gallery`**

Follow the existing card pattern in `src/app/gallery/page.tsx`. The card's body renders one row per step so all 8 utilities appear in scanned source (this is what makes Tailwind generate them) and documents the ladder. Representative body:

```tsx
{[
  ["text-step-0", "12px", "micro — vocab (= text-xs), not yet adopted"],
  ["text-step-1", "13px", "chrome floor: labels, meta, dense text"],
  ["text-step-2", "14px", "body-sm — vocab (= text-sm), not yet adopted"],
  ["text-step-3", "16px", "base/body; small card headings"],
  ["text-step-4", "18px", "vocab (= text-lg), not yet adopted"],
  ["text-step-5", "24px", "vocab (= text-2xl), not yet adopted"],
  ["text-step-6", "30px", "vocab (= text-3xl), not yet adopted"],
  ["text-step-7", "32px", "hero/display"],
].map(([cls, px, role]) => (
  <div key={cls} className="flex items-baseline gap-3 border-b border-border-soft py-1.5 last:border-0">
    <span className={cls + " font-semibold text-text"}>Ag</span>
    <span className="num text-step-1 text-text-2">{cls}</span>
    <span className="num text-step-1 text-text-3">{px}</span>
    <span className="text-step-1 text-text-3">{role}</span>
  </div>
))}
```

Wrap in the same Card/section wrapper the other gallery entries use (title e.g. "Type scale (DSN-11)").

- [ ] **Step 5: Prove utility generation (retires the numeric-name risk EARLY)**

Start the dev server and read the computed font sizes off the new gallery card.

Run: `preview_start` name `"web"` (port 3000). Then navigate to `/gallery` (use `javascript_tool` `window.location.assign('http://localhost:3000/gallery')` — the Browser `navigate` tool drops the path). Then evaluate:

```js
Object.fromEntries([0,1,2,3,4,5,6,7].map(n => {
  const el = document.createElement('span');
  el.className = 'text-step-' + n;
  document.body.appendChild(el);
  const fs = getComputedStyle(el).fontSize;
  el.remove();
  return ['text-step-' + n, fs];
}))
```

Expected exactly: `step-0 12px, step-1 13px, step-2 14px, step-3 16px, step-4 18px, step-5 24px, step-6 30px, step-7 32px`.
(These elements read 13px etc. only because the classes now exist in source via the gallery card — that IS the generation proof.)

- [ ] **Step 6: Typecheck + checkpoint**

Run: `pnpm typecheck`
Expected: no new errors. Do NOT commit (Task 7).

---

### Task 2: Write the regression-guard test (red first)

**Files:**
- Create: `tests/unit/type-scale.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: an automated lock asserting no swept literal spelling remains in `src/**`.

- [ ] **Step 1: Write the guard test**

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// DSN-11 (WP-K): once the ladder is swept, none of these arbitrary text-size
// literal spellings may reappear in app source. The 5 remaining sub-13px
// arbitrary sites (values .6/.62/.66/.7rem) are intentionally NOT listed —
// they carry a documented token-gap comment pending slices B/D.
const BANNED = [
  "text-[13px]",
  "text-[.8125rem]",
  "text-[0.8125rem]",
  "text-[.95rem]",
  "text-[0.95rem]",
  "text-[2rem]",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe("DSN-11 type-scale sweep", () => {
  it("DSN-11: no swept text-size literals remain in src/", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const b of BANNED) {
          if (line.includes(b)) offenders.push(`${file}:${i + 1}  ${b}`);
        }
      });
    }
    expect(offenders, `swept literals still present:\n${offenders.join("\n")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect RED**

Run: `pnpm exec vitest run tests/unit/type-scale.test.ts --no-file-parallelism`
Expected: **FAIL**, listing every current offender (the ~30 sites across ~25 files). This proves the guard actually detects the literals. (This is the plan's "red" — Tasks 3–5 drive it green.)

---

### Task 3: Sweep shared components / primitives

**Files (modify — font-size token only):** `src/components/AppShell.tsx`, `src/components/PortalShell.tsx`, `src/components/map/MapCaption.tsx`, `src/components/ProfileMenu.tsx`, `src/components/Table.tsx`, `src/components/SearchExpand.tsx`, `src/components/Stat.tsx`, `src/components/NotificationBell.tsx` (its two `text-[13px]` rows only).

**The transformation (apply to every occurrence in these files):**
- `text-[13px]` → `text-step-1`
- `text-[.8125rem]` → `text-step-1`
- `text-[0.8125rem]` → `text-step-1`
- `text-[.95rem]` → `text-step-3`
- `text-[0.95rem]` → `text-step-3`
- `text-[2rem]` → `text-step-7`

- [ ] **Step 1: Enumerate the exact sites**

Run: `pnpm exec grep -rn --include=*.tsx -E 'text-\[(13px|0?\.8125rem|0?\.95rem|2rem)\]' src/components`
(or the Grep tool with pattern `text-\[(13px|0?\.8125rem|0?\.95rem|2rem)\]`). Record every `file:line`.

- [ ] **Step 2: Apply the mapping**

For each site, replace ONLY the matched substring inside the `className`. Leave all sibling classes intact. Known non-obvious sites in this batch:
- `AppShell.tsx:134` brand wordmark `text-[0.95rem]` → `text-step-3`; lines `135/141/169/174` `text-[0.8125rem]` → `text-step-1`.
- `PortalShell.tsx:74` wordmark `text-[0.95rem]` → `text-step-3`; `:94` tab label `text-[13px]` → `text-step-1`.
- `Table.tsx:39` `Th` `text-[0.8125rem]` → `text-step-1`.
- `NotificationBell.tsx:78,79` `text-[13px]` → `text-step-1`. DO NOT touch `:104` (`.6rem`) or `:134` (`.62rem`) — those are Task 6.

- [ ] **Step 3: Guard re-run (fewer offenders) + typecheck**

Run: `pnpm exec vitest run tests/unit/type-scale.test.ts --no-file-parallelism`
Expected: still FAIL, but the offender list no longer contains any `src/components/*` file from this batch.
Run: `pnpm typecheck` — no new errors.

---

### Task 4: Sweep admin pages

**Files (modify — same transformation as Task 3):** `src/app/activity/page.tsx`, `src/app/coverage/page.tsx`, `src/app/unmatched/page.tsx`, `src/app/partners/[id]/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/settings/settings-nav.tsx`, `src/app/settings/notifications/page.tsx`, `src/app/imports/[ref]/page.tsx`, `src/app/leads/lead-dialog.tsx`, `src/app/rules/mls-phrases.tsx`, `src/app/gallery/page.tsx` (its `text-[13px]` rows).

- [ ] **Step 1: Enumerate**

Grep pattern `text-\[(13px|0?\.8125rem|0?\.95rem|2rem)\]` over each file above. Record `file:line`.

- [ ] **Step 2: Apply the mapping (call-outs)**
- `dashboard/page.tsx:54` — the const `const label13 = "text-[.8125rem]"` → `"text-step-1"` (one edit covers all `label13` uses). `:234` hero `text-[2rem]` → `text-step-7` (keeps `leading-[1.12]`). `:283/301/315/355` card-heading `text-[.95rem]` → `text-step-3`.
- `coverage/page.tsx:85/109` card headings `text-[.95rem]` → `text-step-3`; `:30/32/92/111/134` `text-[13px]` → `text-step-1`.
- `unmatched/page.tsx:151` heading `text-[.95rem]` → `text-step-3`; `:88/153` `text-[.8125rem]` → `text-step-1`.
- `partners/[id]/page.tsx:207/230/265/277` headings `text-[.95rem]` → `text-step-3`; `:110/249` `text-[.8125rem]` → `text-step-1`.
- `imports/[ref]/page.tsx` — all `text-[.8125rem]`/`text-[13px]` → `text-step-1` (`:61/62/181/202/212/231/399`).
- Others (`activity`, `settings-nav`, `settings/notifications`, `leads/lead-dialog`, `rules/mls-phrases`, `gallery` rows) — all `text-[13px]`/`text-[.8125rem]` → `text-step-1`.

- [ ] **Step 3: Guard re-run + typecheck**

Run the guard + `pnpm typecheck`. Expected: guard offenders now confined to `src/app/portal/*` (Task 5) + the 5 sub-13px sites (never in the guard list). No new type errors.

---

### Task 5: Sweep portal pages (drives the guard GREEN)

**Files (modify — same transformation):** `src/app/portal/dashboard/portal-dashboard.tsx`, `src/app/portal/devices/page.tsx`, `src/app/portal/portal-account.tsx`, `src/app/portal/activity/page.tsx`, `src/app/portal/leads/page.tsx`, `src/app/portal/leads/[ref]/page.tsx`.

- [ ] **Step 1: Enumerate** — grep the pattern over `src/app/portal`.

- [ ] **Step 2: Apply the mapping (call-out)**
- `portal-dashboard.tsx:28` — const `const label13 = "text-[.8125rem]"` → `"text-step-1"`.
- All other portal sites are `text-[13px]` → `text-step-1`.

- [ ] **Step 3: Guard re-run — expect GREEN**

Run: `pnpm exec vitest run tests/unit/type-scale.test.ts --no-file-parallelism`
Expected: **PASS** (`offenders` empty). If any remain, the message lists `file:line` — sweep them.
Run: `pnpm typecheck` — no new errors.

---

### Task 6: Sub-13px token-gap comments (DSN-11 compliance, no size change)

**Files (modify — add a comment ONLY, do not change the size):** `src/components/CoverageMap.tsx:117`, `src/components/PartnerTag.tsx:31`, `src/components/NotificationBell.tsx:104` & `:134`, `src/app/gallery/page.tsx:184`.

The DSN-11 rule permits an arbitrary value if an inline comment cites the token gap. Add a JSX comment on the line above each element (do NOT alter the `text-[…]` value):

- [ ] **Step 1: Add the comments**
- `PartnerTag.tsx:31` (refId `.66rem`): `{/* DSN-11 gap: sub-floor refId size — sizing owned by slice B (PartnerTag size=sm). */}`
- `NotificationBell.tsx:104` (badge `.6rem`): `{/* DSN-11 gap: sub-floor count badge — sizing owned by slice D (touch targets). */}`
- `NotificationBell.tsx:134` (group label `.62rem`): `{/* DSN-11 gap: sub-floor group label — sizing owned by slice B/D. */}`
- `CoverageMap.tsx:117` (`.7rem`): `{/* DSN-11 gap: sub-floor map micro-label — pending sub-13px pass. */}`
- `gallery/page.tsx:184` (`.66rem`): `{/* DSN-11 gap: sub-floor token varName — pending sub-13px pass. */}`

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck` — no new errors. (These lines contain sub-13px literals not in the guard's BANNED list, so the guard stays green.)

---

### Task 7: Full verification, reviews, walkthrough, single commit

- [ ] **Step 1: Full unit suite (serial)**

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green including `type-scale.test.ts`. (Pre-existing unrelated red: `tests/integration/audit-immutability.test.ts` is integration, not unit — not run here.)

- [ ] **Step 2: Typecheck + lint changed files**

Run: `pnpm typecheck`; then `pnpm exec eslint <every file touched in Tasks 1,3,4,5,6 + tests/unit/type-scale.test.ts>`.
Expected: clean on changed files.

- [ ] **Step 3: Behavioral proof — computed sizes on real swept pages**

Dev server running. Via `javascript_tool` on `/dashboard` (or `/coverage`): read `getComputedStyle` of a swept 13px element (a table/meta span) → `13px`; the hero (`/dashboard` h2) → `32px`; a card heading (`.95rem`→step-3) → `16px`. Confirms the sweep rendered the intended sizes.

- [ ] **Step 4: Real screenshots (Playwright MCP, both themes)**

Render authed pages via a THROWAWAY public route under `src/app/gallery/<name>/` (public per `src/proxy.ts`) with real components + mock data, `?t=light|dark` data-theme setter. Screenshot: dashboard hero (`step-7`), a table + card heading page (`/coverage` or `/partners/[id]`). Confirm visually inert vs. the current look. Then DELETE the throwaway subdir (keep the permanent `gallery/page.tsx`) and `rm -rf .playwright-mcp`. Stop the dev server.

- [ ] **Step 5: PLAYBOOK §6 self-audit**

Open `docs/PLAYBOOK.md` §6, fill the checklist against this diff, paste it into the summary. Confirm: PRN-12 (no hex; arbitraries either tokenized or comment-documented), zero visual change except the sanctioned `.95→16`, no `text-xs/sm/…` touched, requirement-ID test name, Tier B.

- [ ] **Step 6: Audit agents on the diff**

Dispatch in parallel: `pr-reviewer` (always), `audit-design-system` (token discipline — mandatory), `audit-a11y` (type sizes + the `.95→16` nudge). Address findings (verify each against real code first — audit findings can cite non-existent specifics). NOT tenancy/data/pipeline (no scoped queries, no migration, no pipeline).

- [ ] **Step 7: Owner walkthrough → gated single commit**

Present screenshots + self-audit + review results to the owner. On explicit **"go"**, make the ONE WP-K commit (spec + plan + code):

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(wp-k): DSN-11 type-scale ladder + arbitrary-literal sweep

text-step-0..7 in @theme (font-size only); sweep ~30 text-[...] literals
(13px→step-1, .95rem→step-3, 2rem→step-7); drop dead --step-* vars;
sub-13px arbitraries documented pending slices B/D; regression guard.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

Do NOT push. Await a second explicit "go" before `git push`.

---

## Self-Review (against the spec)

**Spec coverage:** §3 ladder → Task 1. §3 delete dead vars → Task 1 Step 3. §4 sweep (13/16/32) → Tasks 3–5. §5 sub-13px comments → Task 6. §5 no tokens.ts mirror → honored (no tokens.ts task). §6 guard test → Task 2. §7 verification (computed readback, screenshots, typecheck, agents, walkthrough, one commit) → Task 7. §2.4 `.95→step-3` → Tasks 3–4 call-outs. §8 Tier B / no ADR → commit + self-audit. All covered.

**Placeholder scan:** No TBD/TODO. The "enumerate via grep" steps are deliberate (authoritative set re-derived at implementation time per spec §4), each paired with concrete call-outs and exact mappings.

**Type/name consistency:** `text-step-0…7` used identically in Task 1 (definition), the gallery card, Tasks 3–5 (targets), and the guard's BANNED list (which lists the *source* literals, not the step names — correct). `label13` const rename appears in Task 4 (dashboard) and Task 5 (portal) — both → `"text-step-1"`, consistent. Guard file lives in `tests/` (not scanned by its own `walk("src")`), so its BANNED string literals don't self-trip.
