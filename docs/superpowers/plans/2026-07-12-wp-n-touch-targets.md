# WP-N — Touch targets: shared chrome icon buttons ≥44px — Implementation Plan

> **For agentic workers:** execute inline (superpowers:executing-plans). Small, no pure logic (CSS sizing). Steps use `- [ ]`.

**Goal:** The 4 shared chrome icon buttons (bell, theme, search, menu) reach a 44px tappable box, and the NotesPanel "Add note" button uses the 44px `lg` size — icons/behavior unchanged.

**Architecture:** Inline size bumps (`h-8`/`h-9 w-*` → `h-11 w-11`; NotesPanel `<Button>` → `size="lg"`). Trim the two sticky headers' `py-3`→`py-2` if the 44px controls bloat them (decide against a screenshot).

**Spec:** `docs/superpowers/specs/2026-07-12-wp-n-touch-targets-design.md`

## Global Constraints
- 44px = `h-11 w-11` (2.75rem). Keep `place-items-center` so the SVG stays its current size — only the box grows.
- No icon-size, color, focus-ring, hover, or behavior change. No `IconButton` extraction. No form-control resizing.
- No commits until Task 3, gated on explicit owner "go"; second go before push.
- Verification is runtime (computed-readback + screenshots), not unit tests (no pure logic).

---

### Task 1: Bump the 5 controls

**Files:** `src/components/NotificationBell.tsx`, `src/components/ThemeToggle.tsx`, `src/components/SearchExpand.tsx`, `src/components/AppShell.tsx`, `src/components/NotesPanel.tsx`

- [ ] **Step 1: NotificationBell trigger** (`NotificationBell.tsx:97`) — in the button className, `h-8 w-8` → `h-11 w-11`. (Leave the badge's `min-h-[16px] min-w-[16px]` and its DSN-11 comment untouched.)

- [ ] **Step 2: ThemeToggle** (`ThemeToggle.tsx:23`) — `h-9 w-9` → `h-11 w-11`.

- [ ] **Step 3: SearchExpand** (`SearchExpand.tsx:55`) — the collapsed search button `h-9 w-9` → `h-11 w-11`. (Leave the expanded-input branch alone.)

- [ ] **Step 4: AppShell menu toggle** (`AppShell.tsx:236`) — `h-9 w-9 shrink-0` → `h-11 w-11 shrink-0`.

- [ ] **Step 5: NotesPanel "Add note"** (`NotesPanel.tsx:123`) — add `size="lg"` to the `<Button variant="secondary" …>` (keep every other prop).

- [ ] **Step 6: typecheck** — `pnpm typecheck` (className/prop changes are type-inert; `size="lg"` is a valid `ButtonSize`). Expect clean.

---

### Task 2: Header padding + runtime proof

- [ ] **Step 1: Boot dev server + computed-readback (admin).** `preview_start` name `web`. On `/gallery` (public) the chrome isn't present, so render/inspect via a public route that mounts `AppShell` — OR read the components in a throwaway public route under `src/app/gallery/<name>/` that renders `<AppShell>` with mock data. Then eval, for each control (bell/theme/search/menu button):
```js
[...document.querySelectorAll('[aria-label]')]
  .filter(el => /Notifications|Theme:|Search|Toggle navigation/.test(el.getAttribute('aria-label')||''))
  .map(el => ({ label: el.getAttribute('aria-label'), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
```
Expect each `w >= 44 && h >= 44`.

- [ ] **Step 2: Decide header padding.** Screenshot the admin topbar + portal header. If the 44px controls make a header look bloated, change that header's `py-3`→`py-2` (`AppShell.tsx:229`, `PortalShell.tsx:66`) and re-screenshot. Acceptance: controls are 44px AND the header reads correctly. Record the decision.

- [ ] **Step 3: Screenshots** — admin topbar + portal header, light + dark (Playwright MCP; the in-app screenshot times out). Confirm bell/theme reach 44px in BOTH shells and NotesPanel's "Add note" is the taller `lg` button. Delete any throwaway route; `rm -rf .playwright-mcp`; stop the dev server.

- [ ] **Step 4: Full unit suite + lint.** `pnpm test:unit -- --no-file-parallelism` (nothing should break — no logic changed) + `pnpm exec eslint <changed files>`.

---

### Task 3: Reviews, self-audit, gated commit

- [ ] **Step 1: PLAYBOOK §6 self-audit** — fill + print. Confirm no behavior/query/token change; DSN-03 (component states intact — only size changed); requirement-ID (F-66) referenced; Tier B.

- [ ] **Step 2: Reviews** — dispatch in parallel: `pr-reviewer` (always), `audit-a11y` (mandatory — WCAG 2.5.5/2.5.8 target size: confirm 44px met on all 5, focus/hover/label unchanged, no new regressions), `audit-design-system` (chrome control-sizing consistency; confirm the bump doesn't break visual rhythm and no icon/token changed). Address findings (verify against real code first).

- [ ] **Step 3: Owner walkthrough → gated commit.** Present screenshots + readback + self-audit + reviews. On explicit "go":

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(wp-n): 44px touch targets for shared chrome icon buttons (F-66)

Bell/theme/search/menu-toggle icon buttons → h-11 w-11 (44px tappable box,
icon unchanged via place-items-center); NotesPanel "Add note" → Button
size="lg". Fixes both admin and portal via the shared bell/theme components.
Header vertical padding trimmed where needed to keep the topbar unbloated.
No behavior/icon/color/focus change. ProfileMenu (already ~48px row) untouched.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```
Do NOT push; await a second "go".

---

## Self-Review (against the spec)
**Coverage:** §3 icon bumps → Task 1 Steps 1-4; §3 NotesPanel → Step 5; §3 header padding → Task 2 Step 2; §5 verification (readback + screenshots) → Task 2; §6 reviews/commit → Task 3. §4 non-goals honored (no IconButton, no form controls, no icon/behavior change).
**Placeholders:** none — exact file:line + old→new for each control.
**Consistency:** all 5 controls match §1's table; `h-11 w-11` used uniformly; ProfileMenu absent (correctly excluded).
