# WP-E / WS-7 — Settings hub + notification center + profile menu (mockup 09)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Survey-reskin the already-functional Settings hub, notification center, and profile menu to mockup 09, with three targeted deltas: nav-IA regroup (Account/Organization), a notification-center type-icon system, and the Data color-coding toggle on the new `Switch`.

**Architecture:** No backend changes — every feature already exists. New pure helper `notificationTone(type)` + presentational `NotificationTypeIcon` drive the notification tiles. Settings title moves to the topbar via a `"use client"` `SettingsHeader` (the layout is a server component). Nav grouping, avatar color, and the Data toggle are edits to existing files.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query, Tailwind v4 (semantic tokens via `@/lib/cn`), Vitest + Testing Library, Playwright MCP for screenshots.

## Global Constraints

- **PRN-12:** tokens only — no hardcoded hex/font. Notification tiles use `brand-soft`/`success`/`info`/`surface-3` tokens.
- **PRN-14:** never color alone — notification tone is conveyed by icon SHAPE + title text (color redundant); unread is a dot SHAPE + tint (not tint alone).
- **PRN-15:** server data via TanStack Query only; no server data copied into component state (the notif-prefs draft is the established edited-draft exception, unchanged).
- **PRN-08:** no query/scope changes in this WP (notifications/settings queries already scoped; untouched).
- **DSN-03:** the Data toggle uses the `Switch` primitive (full state matrix already shipped in WS-6).
- **AUT-14 / F-21 / F-7 / F-87:** preserve NotificationBell behavior exactly — server-side logout, honest error state, `aria-live` unread announcement, visibility-aware polling.
- **Sub-13px chrome floor (WP-C):** bump touched `text-xs`/`.66rem` body-meta to 13px. Leave the established `.6rem`/`.62rem` mono ALL-CAPS micro-labels (nav-group + day headers) — that motif is used app-wide (AppShell nav groups) and in the mockup.
- **No new dependencies without an ADR.**
- **Test names carry requirement IDs** where a requirement applies.
- **ONE commit for the whole WP**, AFTER the owner walkthrough. Tasks 1–4 end at "tests green", NOT at a commit.
- **Env/tooling:** unit tests SERIAL — `pnpm test:unit -- --no-file-parallelism`; always `pnpm typecheck` separately; lint only CHANGED files.

## Confirmed decisions (owner)
- Nav grouping = mockup: **Account** (Profile · Workspace · Notifications · Security · Appearance) · **Organization** (Data & Export · Billing · Team).
- Notification prefs matrix **stays Checkbox** (draft-then-Save form); Switch is reused on the Data color-coding instant-apply toggle.
- **Add** notification-center type-icon tiles.

---

## File Structure

- **Create** `src/lib/notification-visual.ts` — pure `notificationTone(type)` → tone enum. One responsibility: type→tone mapping.
- **Create** `src/components/NotificationTypeIcon.tsx` — presentational tokened tile + tone icon. Consumed by NotificationBell + gallery.
- **Modify** `src/components/index.ts` — barrel-export `NotificationTypeIcon`.
- **Modify** `src/components/NotificationBell.tsx` — swap the left unread dot for the type tile; unread dot → right; 13px body/timestamp.
- **Create** `src/app/settings/settings-header.tsx` — `"use client"` component that sets the topbar title.
- **Modify** `src/app/settings/layout.tsx` — drop in-body h1/lede; render `<SettingsHeader/>`; keep nav+panel grid.
- **Modify** `src/app/settings/settings-nav.tsx` — two groups (Account/Organization); "General"→"Workspace".
- **Modify** `src/app/settings/profile/page.tsx` — avatar `text-white`→`text-brand-contrast`.
- **Modify** `src/app/settings/data/page.tsx` — color-coding `Checkbox`→`Switch`.
- **Modify** `src/app/settings/notifications/page.tsx` — 13px header/role labels (keep Checkbox).
- **Modify** `src/app/gallery/page.tsx` — notification type-tile demo.
- **Create** `tests/unit/notification-visual.test.ts` — the pure mapping.
- **Create** `tests/unit/components/settings-nav.test.tsx` — nav groups + active state.

---

## Task 1: Notification tone helper + `NotificationTypeIcon` (TDD)

**Files:**
- Test: `tests/unit/notification-visual.test.ts`
- Create: `src/lib/notification-visual.ts`, `src/components/NotificationTypeIcon.tsx`
- Modify: `src/components/index.ts`, `src/app/gallery/page.tsx`

**Interfaces:**
- Produces:
  ```ts
  type NotificationTone = "route" | "success" | "info" | "neutral";
  function notificationTone(type: string): NotificationTone;
  function NotificationTypeIcon(props: { type: string; className?: string }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notification-visual.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { notificationTone } from "@/lib/notification-visual";

describe("notificationTone", () => {
  it("maps known notification types to tones", () => {
    expect(notificationTone("run_summary")).toBe("success");
    expect(notificationTone("new_leads")).toBe("route");
    expect(notificationTone("assigned_lead")).toBe("route");
    expect(notificationTone("status_change")).toBe("info");
  });

  it("falls back to neutral for an unknown type", () => {
    expect(notificationTone("something_unmapped")).toBe("neutral");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/notification-visual.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/notification-visual.ts`:

```ts
// Maps an in-app notification `type` (created in src/modules/notify/outbox.ts:
// new_leads · assigned_lead · run_summary · status_change) to a visual tone. Pure,
// so it's unit-tested independently of the icon JSX. Unknown types fall back to
// neutral so a new server-side type never renders blank.

export type NotificationTone = "route" | "success" | "info" | "neutral";

const TONE_BY_TYPE: Record<string, NotificationTone> = {
  new_leads: "route",
  assigned_lead: "route",
  run_summary: "success",
  status_change: "info",
};

export function notificationTone(type: string): NotificationTone {
  return TONE_BY_TYPE[type] ?? "neutral";
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/notification-visual.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `NotificationTypeIcon`**

Create `src/components/NotificationTypeIcon.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/cn";
import { notificationTone, type NotificationTone } from "@/lib/notification-visual";

// A tokened tile + tone icon for a notification type (NTF-04, WS-7). Icon SHAPE + the
// adjacent title carry the meaning; the tint is redundant (PRN-14). Purely presentational
// so NotificationBell, the gallery, and screenshot routes all render identical tiles.

const TILE: Record<NotificationTone, string> = {
  route: "bg-brand-soft text-brand-ink",
  success: "bg-success/15 text-success",
  info: "bg-info/15 text-info",
  neutral: "bg-surface-3 text-text-3",
};

function ToneIcon({ tone }: { tone: NotificationTone }) {
  const p = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tone === "success") return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
  if (tone === "route") return <svg {...p}><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" /></svg>;
  if (tone === "info") return <svg {...p}><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>;
  return (
    <svg {...p}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export interface NotificationTypeIconProps {
  type: string;
  className?: string;
}

export function NotificationTypeIcon({ type, className }: NotificationTypeIconProps) {
  const tone = notificationTone(type);
  return (
    <span aria-hidden="true" className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", TILE[tone], className)}>
      <ToneIcon tone={tone} />
    </span>
  );
}
```

Add to `src/components/index.ts` (near `NotificationBell`):

```ts
export { NotificationTypeIcon, type NotificationTypeIconProps } from "./NotificationTypeIcon";
```

- [ ] **Step 6: Add a gallery demo**

In `src/app/gallery/page.tsx`, add `NotificationTypeIcon` to the `@/components` import list. Then, immediately after the Switch demo `<Card>` (Task 2 of WS-6), insert:

```tsx
<Card>
  <CardHeader><CardTitle>Notification type tiles</CardTitle></CardHeader>
  <CardBody className="flex flex-col gap-3">
    {[
      { type: "run_summary", label: "Import IM-26-044 distributed 412 leads." },
      { type: "new_leads", label: "36 new leads matched to your territory." },
      { type: "status_change", label: "A lead you own moved to Contacted." },
      { type: "system", label: "Unmapped type — neutral fallback." },
    ].map((n) => (
      <div key={n.type} className="flex items-start gap-2.5">
        <NotificationTypeIcon type={n.type} />
        <div className="min-w-0">
          <p className="text-sm text-text">{n.label}</p>
          <p className="num text-[13px] text-text-3">{n.type}</p>
        </div>
      </div>
    ))}
  </CardBody>
</Card>
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 2: NotificationBell reskin

**Files:**
- Modify: `src/components/NotificationBell.tsx`

**Interfaces:**
- Consumes: `NotificationTypeIcon` (Task 1).

- [ ] **Step 1: Import the tile**

In `src/components/NotificationBell.tsx`, add to the imports:

```tsx
import { NotificationTypeIcon } from "./NotificationTypeIcon";
```

- [ ] **Step 2: Replace the `row` renderer**

Replace the existing `row` function (currently `NotificationBell.tsx:69-78`) with:

```tsx
  const row = (n: Notification) => (
    <div className="flex items-start gap-2.5">
      <NotificationTypeIcon type={n.type} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{n.title}</p>
        {n.body && <p className="text-[13px] text-text-3">{n.body}</p>}
        <p className="num mt-0.5 text-[13px] text-text-3">{timeAgo(n.createdAt)}</p>
      </div>
      {/* Unread = a dot SHAPE on the right (never tint alone) — PRN-14. */}
      {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />}
    </div>
  );
```

(The unread row background tint `bg-brand-soft/40` on the `DropdownMenuItem` is unchanged and remains a redundant, not sole, unread cue.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Run the existing NotificationBell test**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/components/ws7-components.test.tsx`
Expected: PASS — behavior (error state, unread announcement) unchanged.

---

## Task 3: Settings shell (title→topbar) + nav IA

**Files:**
- Create: `src/app/settings/settings-header.tsx`
- Modify: `src/app/settings/layout.tsx`, `src/app/settings/settings-nav.tsx`
- Test: `tests/unit/components/settings-nav.test.tsx`

**Interfaces:**
- Consumes: `usePageHeader`, `AppShell`, `ToastProvider` from `@/components` (existing).

- [ ] **Step 1: Write the failing SettingsNav test**

Create `tests/unit/components/settings-nav.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/data" }));

import { SettingsNav } from "@/app/settings/settings-nav";

describe("SettingsNav", () => {
  it("groups sections under Account and Organization", () => {
    render(<SettingsNav />);
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    // Workspace sits under Account, Data & Export under Organization.
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/settings/workspace");
    expect(screen.getByRole("link", { name: "Data & Export" })).toHaveAttribute("href", "/settings/data");
  });

  it("marks the active section from the URL", () => {
    render(<SettingsNav />);
    expect(screen.getByRole("link", { name: "Data & Export" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute("aria-current");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/components/settings-nav.test.tsx`
Expected: FAIL — no "Organization" group / "Workspace" link yet (current groups are Account/Workspace/Plan, item labelled "General").

- [ ] **Step 3: Regroup the nav**

In `src/app/settings/settings-nav.tsx`, replace the `GROUPS` constant with:

```ts
const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Account", items: [
    { href: "/settings/profile", label: "Profile" },
    { href: "/settings/workspace", label: "Workspace" },
    { href: "/settings/notifications", label: "Notifications" },
    { href: "/settings/security", label: "Security" },
    { href: "/settings/appearance", label: "Appearance" },
  ] },
  { label: "Organization", items: [
    { href: "/settings/data", label: "Data & Export" },
    { href: "/settings/billing", label: "Billing" },
    { href: "/settings/team", label: "Team" },
  ] },
];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/components/settings-nav.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the topbar-title setter**

Create `src/app/settings/settings-header.tsx`:

```tsx
"use client";

import { usePageHeader } from "@/components";

// WS-7: the Settings hub shows its title in the topbar (like every other list/hub page).
// The layout is a server component, so this tiny client child owns the usePageHeader call
// and renders nothing; unmounting on navigation clears the topbar title.
export function SettingsHeader() {
  usePageHeader({ title: "Settings" });
  return null;
}
```

- [ ] **Step 6: Update the layout**

Replace the contents of `src/app/settings/layout.tsx` with:

```tsx
import * as React from "react";
import { AppShell, ToastProvider } from "@/components";
import { SettingsNav } from "./settings-nav";
import { SettingsHeader } from "./settings-header";

// WS-7: the Settings hub. One AppShell + ToastProvider + left sub-nav wraps every
// /settings/* section. The "Settings" title lives in the topbar (SettingsHeader); each
// section renders its own SettingsSection header.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <ToastProvider>
        <SettingsHeader />
        <div className="grid gap-8 lg:grid-cols-[210px_1fr]">
          <SettingsNav />
          <div className="min-w-0 max-w-[760px]">{children}</div>
        </div>
      </ToastProvider>
    </AppShell>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 4: Settings section deltas (avatar · Data Switch · notif-prefs 13px)

**Files:**
- Modify: `src/app/settings/profile/page.tsx`, `src/app/settings/data/page.tsx`, `src/app/settings/notifications/page.tsx`

- [ ] **Step 1: Avatar contrast (profile)**

In `src/app/settings/profile/page.tsx`, change the avatar span (line ~29) from `text-white` to `text-brand-contrast`:

```tsx
              <span className="grid h-12 w-12 place-items-center rounded-full bg-brand text-base font-semibold text-brand-contrast">
                {initialsFromEmail(data.email)}
              </span>
```

- [ ] **Step 2: Data color-coding → Switch**

In `src/app/settings/data/page.tsx`: change the `@/components` import to drop `Checkbox` and add `Switch` (both are otherwise only used for this one control), then replace the checkbox at line ~63:

```tsx
                <Switch checked={data.colorCoding} disabled={saveColor.isPending} onCheckedChange={(v) => saveColor.mutate(v)} ariaLabel="Color-code exports" />
```

- [ ] **Step 3: Notification-prefs 13px labels (keep Checkbox)**

In `src/app/settings/notifications/page.tsx`, bump the two sub-13px meta labels to 13px:
- the header row (line ~86): `text-xs font-semibold text-text-3` → `text-[13px] font-semibold text-text-3`
- the per-row role label (line ~97): `text-xs text-text-3 capitalize` → `text-[13px] text-text-3 capitalize`

(No other change — the Checkbox matrix stays.)

- [ ] **Step 4: Typecheck + full serial unit suite + lint changed files**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green (prior baseline + `notification-visual` (2) + `settings-nav` (2)).

Run:
```
pnpm exec eslint src/lib/notification-visual.ts src/components/NotificationTypeIcon.tsx src/components/index.ts src/components/NotificationBell.tsx src/app/settings/settings-header.tsx src/app/settings/layout.tsx src/app/settings/settings-nav.tsx src/app/settings/profile/page.tsx src/app/settings/data/page.tsx src/app/settings/notifications/page.tsx src/app/gallery/page.tsx tests/unit/notification-visual.test.ts tests/unit/components/settings-nav.test.tsx
```
Expected: no errors.

---

## Task 5: Screenshots · self-review · single commit

**Files:**
- Create (throwaway): `src/app/gallery/settings-preview/page.tsx`, `src/app/gallery/notif-preview/page.tsx`
- Delete before commit.

- [ ] **Step 1: Throwaway two-theme preview routes**

Create `src/app/gallery/settings-preview/page.tsx` — renders the real `SettingsNav` + a mock Data & Export panel (with the `Switch`) + the avatar, with a `?t=light|dark` setter. Create `src/app/gallery/notif-preview/page.tsx` — renders example notification rows (using `NotificationTypeIcon`) grouped by day, one unread. Both public per `src/proxy.ts`. (Use mock data + the REAL components; DELETE before commit.)

- [ ] **Step 2: Dev server + screenshot both themes**

`preview_start` name `"web"`. Via Playwright MCP, screenshot `…/gallery/settings-preview?t=light|dark` and `…/gallery/notif-preview?t=light|dark`. Verify: topbar-less preview shows the two nav groups (Account/Organization); the Data toggle is a marigold Switch; the avatar initials read on marigold (no white-on-marigold); notification tiles show distinct tone colors with legible icons; no console errors from our components.

- [ ] **Step 3: Print the PLAYBOOK §6 self-audit checklist** (filled; n/a where inapplicable).

- [ ] **Step 4: Self-review the diff with agents (parallel)**

- `pr-reviewer` — correctness / spec / process; confirm no behavior regression in NotificationBell (F-21/F-7/F-87) and no query/scope change.
- `audit-design-system` — token discipline on the notification tiles (`bg-success/15` etc.), theme parity, sub-13px floor.
- `audit-a11y` — notification tile contrast (icon vs tint ≥3:1 both themes, SC 1.4.11), unread signalled by more than color, nav landmark/active-state, avatar contrast.

Address every finding (fix inline or record as a deferred WP candidate). Re-run typecheck + serial suite after fixes.

- [ ] **Step 5: Delete throwaway preview routes**

```bash
rm -rf src/app/gallery/settings-preview src/app/gallery/notif-preview
```
Run `pnpm typecheck` again.

- [ ] **Step 6: Owner walkthrough** — present the four screenshots (settings + notif, both themes). Wait for approval BEFORE committing.

- [ ] **Step 7: ONE commit (after approval)**

```bash
git add src/lib/notification-visual.ts src/components/NotificationTypeIcon.tsx src/components/index.ts src/components/NotificationBell.tsx src/app/settings/settings-header.tsx src/app/settings/layout.tsx src/app/settings/settings-nav.tsx src/app/settings/profile/page.tsx src/app/settings/data/page.tsx src/app/settings/notifications/page.tsx src/app/gallery/page.tsx tests/unit/notification-visual.test.ts tests/unit/components/settings-nav.test.tsx docs/superpowers/plans/2026-07-11-wp-e-ws7-settings.md
git commit -m "feat(wp-e/ws-7): Settings + notifications — Survey reskin, nav IA, notification type tiles"
```

---

## Self-Review (plan vs. brief/spec/decisions)

**Coverage:**
- Nav IA regroup (Account/Organization, "General"→"Workspace") → Task 3 ✓
- Settings title→topbar → Task 3 (SettingsHeader) ✓
- Avatar `text-white`→`brand-contrast` → Task 4 ✓
- Data color-coding Checkbox→Switch → Task 4 ✓
- Notification type-icon tiles (+ pure tone helper, tested) → Tasks 1–2 ✓
- Notification prefs stay Checkbox, 13px labels → Task 4 ✓
- NotificationBell behavior preserved (F-21/F-7/F-87/deep-links/mark-read) → Task 2 (row-only change) ✓
- Gallery closes the "NotificationBell absent from /gallery" follow-up via type-tile demo → Task 1 ✓
- Two-theme screenshots + self-review + one commit → Task 5 ✓

**Placeholder scan:** none — all code steps are complete.

**Type consistency:** `NotificationTone` defined in `notification-visual.ts`, imported by `NotificationTypeIcon`; `notificationTone(type)` signature identical across helper, component, and test; `NotificationTypeIconProps.type: string` matches `Notification.type: string` passed from NotificationBell.

**Out of scope (deferred candidates):** the mockup's partner-swatch preview strip under the color-coding toggle (needs a partners fetch — decorative); embedding the live `NotificationBell` (not just tiles) into `/gallery` (needs a data-injection refactor); theme control as a `SegmentedControl` (appearance radiogroup is already accessible).
