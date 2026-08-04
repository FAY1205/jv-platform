# WP-O — IconButton primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract one 44px `IconButton` primitive and route the four shared chrome icon buttons (AppShell menu toggle, ThemeToggle, SearchExpand, NotificationBell trigger) through it, unifying their divergent hover/focus recipes.

**Architecture:** New `src/components/IconButton.tsx` — a `forwardRef` icon-only button, 44px, tokens-only, with the ThemeToggle/SearchExpand hover+focus recipe as its single state matrix and a `loading` spinner reused from Button. Four call-sites swap their hand-rolled `<button>` for it; ThemeToggle/SearchExpand stay pixel-identical, the bell's hover/focus normalize, the menu toggle gains the focus hairline. Gallery card + unit tests complete it.

**Tech Stack:** React 19 + TypeScript, Tailwind v4 (semantic tokens), Radix (`DropdownMenuTrigger asChild` for the bell), Vitest + @testing-library/react (jsdom).

## Global Constraints

- PRN-12: no hardcoded hex/font/logo/product name — semantic tokens from `lib/tokens` / Tailwind token classes only.
- DSN-03: every interactive component implements default/hover/focus-visible/active/disabled/loading.
- FRONTEND_STANDARDS §2: every primitive has a `/gallery` card with its full state matrix.
- All UI built from `src/components` (barrel-exported via `src/components/index.ts`).
- Test names carry requirement IDs: `it("DSN-IB-01: …")`.
- Vitest runs SERIAL: `pnpm exec vitest run <file> --no-file-parallelism`. Typecheck separately: `pnpm typecheck`. Lint changed files only: `pnpm exec eslint <files>`.
- Icon-only buttons MUST carry an accessible name (SC 4.1.2) — enforce `aria-label` required in the props type.
- The permanent `src/app/gallery/page.tsx` is committed — edit, never delete. (Only throwaway `src/app/gallery/<name>/` preview subdirs get deleted before commit.)
- One commit for the whole WP. Get explicit owner "go" before committing and before pushing.

---

### Task 1: `IconButton` primitive + export

**Files:**
- Create: `src/components/IconButton.tsx`
- Modify: `src/components/Button.tsx` (export the private `Spinner`)
- Modify: `src/components/index.ts` (barrel export)
- Test: `tests/unit/components/icon-button.test.tsx`

**Interfaces:**
- Consumes: `Spinner` (newly exported from `Button.tsx`), `cn` from `@/lib/cn`.
- Produces:
  ```ts
  export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    "aria-label": string;   // required
    loading?: boolean;
  }
  export const IconButton: React.ForwardRefExoticComponent<
    IconButtonProps & React.RefAttributes<HTMLButtonElement>
  >;
  ```

- [ ] **Step 1: Export the Spinner from Button.tsx**

In `src/components/Button.tsx`, change the spinner declaration from `function Spinner()` to an exported one so IconButton reuses it (no SVG duplication):

```tsx
export function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
```

(Only the `export` keyword is added; body unchanged. `Button` still calls `<Spinner />` locally.)

- [ ] **Step 2: Write the failing test**

Create `tests/unit/components/icon-button.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { IconButton } from "@/components/IconButton";

const Icon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
  </svg>
);

describe("DSN-03: IconButton", () => {
  it("DSN-IB-01: exposes its aria-label as the accessible name", () => {
    render(<IconButton aria-label="Toggle navigation"><Icon /></IconButton>);
    expect(screen.getByRole("button", { name: "Toggle navigation" })).toBeTruthy();
  });

  it("DSN-IB-02: loading sets aria-busy + disabled and swaps the icon for a spinner", () => {
    render(<IconButton aria-label="Search" loading><Icon data-testid="icon" /></IconButton>);
    const btn = screen.getByRole("button", { name: "Search" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("icon")).toBeNull();
    expect(btn.querySelector("svg.animate-spin")).toBeTruthy();
  });

  it("DSN-IB-03: disabled does not fire onClick", () => {
    const onClick = vi.fn();
    render(<IconButton aria-label="Search" disabled onClick={onClick}><Icon /></IconButton>);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("DSN-IB-04: forwards ref to the underlying button (Radix asChild contract)", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<IconButton aria-label="Search" ref={ref}><Icon /></IconButton>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("DSN-IB-05: merges a consumer className and passes through aria-expanded", () => {
    render(<IconButton aria-label="Menu" className="ml-2" aria-expanded><Icon /></IconButton>);
    const btn = screen.getByRole("button", { name: "Menu" });
    expect(btn.className).toContain("ml-2");
    expect(btn.className).toContain("h-11");
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("DSN-IB-06: defaults type to button (never submits a form)", () => {
    render(<IconButton aria-label="Menu"><Icon /></IconButton>);
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("type", "button");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/components/icon-button.test.tsx --no-file-parallelism`
Expected: FAIL — `IconButton` cannot be imported from `@/components/IconButton` (module not found).

- [ ] **Step 4: Write the IconButton implementation**

Create `src/components/IconButton.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Button";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon-only buttons must carry an accessible name (SC 4.1.2). */
  "aria-label": string;
  loading?: boolean;
}

// The shared 44px chrome icon button (F-66 tap target). One state recipe for the four
// topbar/chrome controls (AppShell menu toggle, ThemeToggle, SearchExpand, NotificationBell):
// hairline-border hover + the global brand-ink focus outline + subtle focus border. Tokens
// only (PRN-12); forwardRef so it can mount under Radix `DropdownMenuTrigger asChild`.
const base =
  "grid h-11 w-11 shrink-0 place-items-center rounded-md border border-transparent text-text-2 " +
  "transition-colors hover:border-border hover:bg-surface focus-visible:border-border " +
  "active:scale-95 disabled:opacity-50 disabled:pointer-events-none";

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { loading = false, disabled, children, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(base, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
});
```

- [ ] **Step 5: Barrel-export it**

In `src/components/index.ts`, add near the other primitives (e.g. after the `Button` line):

```ts
export { IconButton, type IconButtonProps } from "./IconButton";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/components/icon-button.test.tsx --no-file-parallelism`
Expected: PASS (6 passing).

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: clean (no errors).

---

### Task 2: Swap the four chrome call-sites

**Files:**
- Modify: `src/components/ThemeToggle.tsx:19-24`
- Modify: `src/components/SearchExpand.tsx:49-59`
- Modify: `src/components/AppShell.tsx:230-239`
- Modify: `src/components/NotificationBell.tsx:92-114`

**Interfaces:**
- Consumes: `IconButton` from Task 1.
- Produces: no new exports — behavior-preserving swaps.

- [ ] **Step 1: ThemeToggle** — replace the `<button>` with `IconButton` (render-identical; drop the inline class string).

In `src/components/ThemeToggle.tsx`, add `import { IconButton } from "./IconButton";` and change the returned button:

```tsx
  return (
    <IconButton
      aria-label={`Theme: ${theme}. Switch to ${NEXT_LABEL[theme]}`}
      onClick={() => setPreferences({ theme: nextTheme(theme) })}
    >
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICON[theme]}
      </svg>
    </IconButton>
  );
```

- [ ] **Step 2: SearchExpand** — replace the collapsed-state `<button>` (lines 49-59) with `IconButton`. Leave the expanded `<form>` untouched.

In `src/components/SearchExpand.tsx`, add `import { IconButton } from "./IconButton";` and change the `if (!open)` branch:

```tsx
  if (!open) {
    return (
      <IconButton aria-label="Search" aria-expanded={false} onClick={expand}>
        <SearchIcon className="h-[18px] w-[18px]" />
      </IconButton>
    );
  }
```

- [ ] **Step 3: AppShell menu toggle** — replace the `<button ref={menuBtnRef} …>` (lines 230-239) with `IconButton`. `menuBtnRef` is already `Ref<HTMLButtonElement>`, so `ref` forwards cleanly.

In `src/components/AppShell.tsx`, ensure `IconButton` is imported (it may be a `@/components` barrel import already; if AppShell imports siblings by relative path, use `import { IconButton } from "./IconButton";`). Change:

```tsx
          <IconButton
            ref={menuBtnRef}
            onClick={toggleNav}
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
          >
            <span className="h-[18px] w-[18px]"><Icon name="menu" /></span>
          </IconButton>
```

- [ ] **Step 4: NotificationBell trigger** — replace the `<button>` (lines 94-113) with `IconButton`, keeping the inner badge-anchor span + svg + badge exactly as-is. Drop the divergent `hover:bg-surface-3` and `focus-visible:ring-1 ring-brand-ink` classes (now provided by the primitive).

In `src/components/NotificationBell.tsx`, add `import { IconButton } from "./IconButton";` and change the trigger:

```tsx
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            {/* Badge anchors to this icon-sized wrapper, not the 44px button, so the 44px
                tap target doesn't detach the count from the bell. */}
            <span className="relative grid h-[18px] w-[18px] place-items-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              {/* DSN-11 gap: sub-floor count text — pending the sub-13px pass (not a tap target). */}
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-brand px-1 text-[.6rem] font-bold text-brand-contrast">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </span>
          </IconButton>
        </DropdownMenuTrigger>
```

- [ ] **Step 5: Run the affected component tests + typecheck**

Run: `pnpm exec vitest run tests/unit/components/theme-toggle.test.tsx tests/unit/components/search-expand.test.tsx tests/unit/components/appshell.test.tsx tests/unit/components/components.test.tsx --no-file-parallelism`
Expected: PASS (existing NotificationBell aria-live/error behavior tests, ThemeToggle click, SearchExpand expand, AppShell drawer all green — the button element + aria-labels are unchanged).

Run: `pnpm typecheck`
Expected: clean.

---

### Task 3: Gallery card

**Files:**
- Modify: `src/app/gallery/page.tsx` (add an "IconButton" `Section`; import `IconButton`)

**Interfaces:**
- Consumes: `IconButton` from Task 1 (import from `@/components`).

- [ ] **Step 1: Add the gallery Section**

In `src/app/gallery/page.tsx`, add `IconButton` to the `@/components` import, and add a new `<Section>` after the "Buttons — all states" section (line ~253). Use a real inline icon (e.g. a gear/cog svg) so the card is self-contained:

```tsx
        <Section title="IconButton — 44px chrome control (DSN-03, F-66)">
          <Card>
            <CardBody className="flex flex-wrap items-center gap-3">
              <IconButton aria-label="Settings">
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" />
                </svg>
              </IconButton>
              <IconButton aria-label="Disabled example" disabled>
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                </svg>
              </IconButton>
              <IconButton aria-label="Loading example" loading>
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /></svg>
              </IconButton>
              <span className="text-step-1 text-text-3">Hover = hairline border + surface; focus-visible = 1px brand-ink outline; active = scale-95.</span>
            </CardBody>
          </Card>
        </Section>
```

- [ ] **Step 2: Typecheck + lint the changed files**

Run: `pnpm typecheck`
Expected: clean.

Run: `pnpm exec eslint src/components/IconButton.tsx src/components/Button.tsx src/components/index.ts src/components/ThemeToggle.tsx src/components/SearchExpand.tsx src/components/AppShell.tsx src/components/NotificationBell.tsx src/app/gallery/page.tsx tests/unit/components/icon-button.test.tsx`
Expected: clean (no errors).

---

### Task 4: Full verification, self-audit, owner walkthrough, commit

**Files:** none (verification + review only).

- [ ] **Step 1: Full unit suite (serial)**

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green (531 baseline + 6 new IconButton = 537).

- [ ] **Step 2: Real-screenshot proof**

Create a throwaway `src/app/gallery/iconbtn/page.tsx` rendering the four real chrome components (AppShell topbar cluster or the individual buttons) with mock data; `preview_start` name "web"; Playwright-screenshot both themes via the `?t=light|dark` data-theme setter; confirm theme/search/menu render identically to before and the bell's hover/focus now match. As a renderer-independent backup, use `javascript_tool` to read the four buttons' computed `border`/`background` on hover + `getBoundingClientRect` (44×44). **Delete `src/app/gallery/iconbtn/` and stop the dev server before committing.** Move any stray PNGs out of the repo root to scratchpad; `rm -rf .playwright-mcp`.

- [ ] **Step 3: PLAYBOOK §6 self-audit** — fill and print the checklist in the summary.

- [ ] **Step 4: Audit agents on the diff** (parallel, read-only): `pr-reviewer` (always), `audit-design-system` (MANDATORY — token discipline, state-matrix completeness, primitive governance), `audit-a11y` (icon-only accessible name, focus visibility, 44px target), `audit-frontend-arch` (component reuse, client boundary). Address findings inline; re-verify against real code (findings can cite wrong specifics — see the audit-finding-accuracy learning).

- [ ] **Step 5: Owner walkthrough** — present screenshots + the filled §6 checklist. Get explicit "go".

- [ ] **Step 6: Commit** (after "go") — one commit:

```bash
git add src/components/IconButton.tsx src/components/Button.tsx src/components/index.ts \
  src/components/ThemeToggle.tsx src/components/SearchExpand.tsx src/components/AppShell.tsx \
  src/components/NotificationBell.tsx src/app/gallery/page.tsx \
  tests/unit/components/icon-button.test.tsx \
  docs/superpowers/specs/2026-07-12-wp-o-iconbutton-design.md \
  docs/superpowers/plans/2026-07-12-wp-o-iconbutton.md
git commit -m "feat(wp-o): IconButton primitive — unify 4 chrome icon buttons (F-66/DSN-03)"
```

(Verify `git status` shows no stray screenshots/`.next`/throwaway route staged before committing.)

- [ ] **Step 7: Push** — only after a separate explicit owner "go" to push.

---

## Self-Review

**Spec coverage:** Component (Task 1) · 4 call-site swaps (Task 2) · gallery card (Task 3) · tests (Task 1) · verification/audit/walkthrough/commit (Task 4). PortalShell needs no edit (reuses shared bell/theme — noted in spec). Out-of-scope items (badge sub-13px, ProfileMenu, size variants) explicitly excluded. All spec sections map to a task.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `IconButtonProps` / `IconButton` names identical across tasks; `Spinner` exported in Task 1 Step 1 and imported in the same file's Step 4; all four swaps consume the same `IconButton`.
