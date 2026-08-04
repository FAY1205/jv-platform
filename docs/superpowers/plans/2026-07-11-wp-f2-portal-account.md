# WP-F.2 — Portal Account (+ sign-out) + lead-detail/login/ToS finish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the partner portal a real **Account** screen with a **sign-out** (there is none today), and finish the portal-page pass inside the new PortalShell: one `<h1>` per page, ≥44px touch targets on the login/ToS buttons, and drop the now-inert `max-w-2xl`.

**Architecture:** Frontend-only — reuses the existing `/api/me` (identity) and `/api/auth/logout` (AUT-14 server-side revoke) endpoints; no new backend. Owner declined contact actions on the lead detail, so the lead-detail change is a light polish only.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query, Tailwind v4, Vitest + Testing Library.

## Global Constraints
- **AUT-14:** sign-out POSTs `/api/auth/logout` (server revokes), then clears the query cache and does a full navigation to `/portal/login` (drops client cache so Back reveals no authed data) — mirror the admin `ProfileMenu` exactly.
- **F-66:** login + ToS primary buttons → `size="lg"` (44px); the "Use a different email" button → `min-h-11`.
- **One `<h1>` per page** (audit-a11y): lead-detail, account, activity, devices, login, ToS. Remove/demote any `CardTitle` that duplicates the new `h1`.
- **Sub-13px floor (WP-C):** bump touched `text-xs`/`font-mono text-xs` body-meta to 13px.
- **PRN-12 tokens only; PRN-08/SEC-05:** no query/scope/PII change.
- **Scope (owner):** NO Call/Email/Text contact actions on the lead detail. Territory map/chip/eyebrow + shared-component touch targets (bell/theme/NotesPanel) + `statusPillClass` helper are DEFERRED (backend / app-wide passes).
- **No new dependencies.**
- **ONE commit**, AFTER the owner walkthrough.
- **Env/tooling:** unit tests SERIAL; always `pnpm typecheck`; lint CHANGED files.

## File Structure
- **Create** `src/app/portal/portal-account.tsx` — client Account body: identity (`/api/me`), section links (Devices/Activity/Terms), and the sign-out button.
- **Modify** `src/app/portal/page.tsx` — server ToS-gate keeps; renders `<h1>` + `<PortalAccount/>`.
- **Modify** `src/app/portal/leads/[ref]/page.tsx` — page `<h1>`, drop `max-w-2xl`, 13px history meta.
- **Modify** `src/app/portal/activity/page.tsx` — page `<h1>`, drop `max-w-2xl`, 13px meta.
- **Modify** `src/app/portal/devices/page.tsx` — page `<h1>`, drop `max-w-2xl`, 13px "last seen".
- **Modify** `src/app/portal/login/page.tsx` — buttons → `lg`, "different email" → `min-h-11`, brand → `<h1>`.
- **Modify** `src/app/portal/tos/page.tsx` — button → `lg`, add `<h1>`.
- **Create** `tests/unit/components/portal-account.test.tsx`.

---

## Task 1: Account page + sign-out (TDD)

**Files:**
- Test: `tests/unit/components/portal-account.test.tsx`
- Create: `src/app/portal/portal-account.tsx`
- Modify: `src/app/portal/page.tsx`

**Interfaces:**
- Produces: `PortalAccount()` (client) — fetches `/api/me`, renders identity + links + sign-out.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/portal-account.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({}) }));

import { PortalAccount } from "@/app/portal/portal-account";

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  // jsdom: make window.location.assign spy-able
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
});

function renderAccount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalAccount />
    </QueryClientProvider>,
  );
}

describe("PortalAccount", () => {
  it("AUT-14: signing out POSTs the server logout then navigates to /portal/login", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ email: "p@x.co", role: "partner", workspace: { name: "Acme" } }) } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAccount();

    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/components/portal-account.test.tsx`
Expected: FAIL — module `@/app/portal/portal-account` not found.

- [ ] **Step 3: Implement `PortalAccount`**

Create `src/app/portal/portal-account.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, Button, Skeleton } from "@/components";
import { initialsFromEmail } from "@/lib/identity";

// WP-F.2: the portal "Account" tab body. Identity from /api/me (PRN-08 — caller's own
// row only), links to the other account surfaces, and the portal's first sign-out
// (AUT-14: server-side revoke, then a full navigation that drops the client cache).
interface Me {
  email: string;
  role: string;
  workspace: { name: string };
}

const LINKS = [
  { href: "/portal/devices", label: "Your devices", hint: "Remembered browsers you can sign out" },
  { href: "/portal/activity", label: "Your activity", hint: "Your status updates and notes" },
  { href: "/portal/tos", label: "Terms of service", hint: "The terms you accepted" },
];

export function PortalAccount() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/me") });
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ scope: "local" }),
      });
    } catch {
      // Navigate away regardless — the session cookie is HttpOnly + server-revoked.
    }
    qc.clear();
    window.location.assign("/portal/login");
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody>
          {isPending || !data ? (
            <Skeleton className="h-12" />
          ) : (
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-3 text-base font-semibold text-text-2">
                {initialsFromEmail(data.email)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text">{data.email}</p>
                <p className="text-[13px] capitalize text-text-3">{data.role} · {data.workspace.name}</p>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-col gap-2">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex min-h-[52px] flex-col justify-center rounded-xl border border-border bg-surface px-4 py-2.5 transition-colors hover:border-text-3 hover:bg-surface-2 focus-visible:border-brand-ink"
          >
            <span className="text-sm font-semibold text-text">{l.label}</span>
            <span className="text-[13px] text-text-3">{l.hint}</span>
          </Link>
        ))}
      </div>

      <Button variant="secondary" size="lg" loading={signingOut} onClick={signOut} className="mt-1 w-full">
        Sign out
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/components/portal-account.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into the Account page**

In `src/app/portal/page.tsx`: drop the `Card`/`CardHeader`/`CardTitle`/`CardBody` link-grid, keep the server ToS-gate, and render the new body. Replace the imports + the returned JSX:

```tsx
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance } from "@/lib/legal/tos";
import { PortalAccount } from "./portal-account";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  let userId: string;
  try {
    userId = (await getServerScope()).userId;
  } catch {
    redirect("/portal/login");
  }
  const accepted = await latestTosVersion(getDb(), userId);
  if (needsTosAcceptance(accepted)) redirect("/portal/tos");

  return (
    <main className="mx-auto w-full flex-1 p-4">
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text">Your account</h1>
      <PortalAccount />
    </main>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 2: Lead-detail / activity / devices — h1 + max-w + 13px

**Files:**
- Modify: `src/app/portal/leads/[ref]/page.tsx`, `src/app/portal/activity/page.tsx`, `src/app/portal/devices/page.tsx`

- [ ] **Step 1: Lead detail**

In `src/app/portal/leads/[ref]/page.tsx`:
- Change the `<main>` wrapper: `mx-auto w-full max-w-2xl flex-1 p-6` → `mx-auto w-full flex-1 p-4`.
- Add a page heading right after the back-link (and drop the redundant `refId` from the first card's `CardHeader`, leaving just the status `Badge`):
  ```tsx
  <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text">
    Lead <span className="num">{ref}</span>
  </h1>
  ```
  In the first `<CardHeader>`, remove the `<CardTitle><span className="font-mono">{data.refId}</span></CardTitle>` (keep the `<Badge>{data.status}</Badge>`; adjust the header to right-align the badge).
- Bump the history timestamp `font-mono text-xs text-text-3` (line ~138) → `num text-[13px] text-text-3`.

- [ ] **Step 2: Activity**

In `src/app/portal/activity/page.tsx`: change the `<main>` `max-w-2xl … p-6` → `w-full … p-4`; add `<h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text">Your activity</h1>` and drop the duplicate `CardTitle` if the card titles it "activity"; bump any `text-xs` item-meta to `text-[13px]`.

- [ ] **Step 3: Devices**

In `src/app/portal/devices/page.tsx`: change the `<main>` `max-w-2xl … p-6` → `w-full … p-4`; replace the `<Card><CardHeader><CardTitle>Your devices</CardTitle></CardHeader>` with a page `<h1 className="mb-4 …">Your devices</h1>` + `<Card>` (no header); bump the "last seen" `font-mono text-xs text-text-3` → `num text-[13px] text-text-3`.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 3: Login + ToS touch targets + h1

**Files:**
- Modify: `src/app/portal/login/page.tsx`, `src/app/portal/tos/page.tsx`

- [ ] **Step 1: Login**

In `src/app/portal/login/page.tsx`:
- Both `<Button type="submit" variant="primary" …>` (Send code / Verify & sign in): add `size="lg"`.
- The "Use a different email" `<button>`: add `min-h-11` to its className (and keep the text styling).
- Make the brand a heading: `<span className="font-display text-lg font-semibold text-text">{APP_NAME}</span>` → `<h1 className="font-display text-lg font-semibold text-text">{APP_NAME}</h1>`.

- [ ] **Step 2: ToS**

In `src/app/portal/tos/page.tsx`: the "I agree — continue" `<Button>` → add `size="lg"`; add a page `<h1>` (promote the `CardTitle`/heading to an `<h1>`, or add one above the card) matching the ToS title, so the page has exactly one h1.

- [ ] **Step 3: Typecheck + full serial suite + lint**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green (baseline + the new PortalAccount test).

Run: `pnpm exec eslint src/app/portal/portal-account.tsx src/app/portal/page.tsx src/app/portal/leads/[ref]/page.tsx src/app/portal/activity/page.tsx src/app/portal/devices/page.tsx src/app/portal/login/page.tsx src/app/portal/tos/page.tsx tests/unit/components/portal-account.test.tsx`
Expected: no errors.

---

## Task 4: Screenshots · self-review · single commit

**Files:**
- Create (throwaway): `src/app/gallery/portal-f2-preview/page.tsx`
- Delete before commit.

- [ ] **Step 1: Throwaway mobile preview**

Create `src/app/gallery/portal-f2-preview/page.tsx` rendering the real `PortalShell` around mock content for: the Account body (identity + links + Sign out) and a lead-detail card, with a `?t=light|dark` setter. (`PortalAccount` itself fetches `/api/me`/logout — for the preview, inline equivalent mock markup so no auth is needed, OR render `PortalAccount` and accept its loading skeleton.) DELETE before commit.

- [ ] **Step 2: Dev server + screenshot mobile (375px) both themes**

`preview_start` name `"web"`. Resize 375×812; screenshot `…/gallery/portal-f2-preview?t=light|dark`. Verify: Account identity block + ≥52px link rows + full-width Sign out; lead-detail h1 + status; ≥44px controls; no console errors from our code.

- [ ] **Step 3: Print the PLAYBOOK §6 self-audit checklist.**

- [ ] **Step 4: Self-review the diff with agents (parallel)**
- `pr-reviewer` — sign-out mirrors ProfileMenu (AUT-14: server revoke + `qc.clear()` + full nav); no query/scope change; single `<h1>` per page; server ToS-gate on portal/page.tsx intact.
- `audit-a11y` — one h1 per page now; login/ToS ≥44px; Account link rows ≥44px; sign-out has a discernible name; bare-mode login unaffected.
- `audit-design-system` — token discipline; 13px floor; Account/link styling consistent with the leads cards.

Address findings (fix inline or defer). Re-run typecheck + serial suite.

- [ ] **Step 5: Delete throwaway preview** — `rm -rf src/app/gallery/portal-f2-preview` + `pnpm typecheck`.

- [ ] **Step 6: Owner walkthrough** — mobile screenshots both themes. Wait for approval.

- [ ] **Step 7: ONE commit (after approval)**
```bash
git add src/app/portal/portal-account.tsx src/app/portal/page.tsx "src/app/portal/leads/[ref]/page.tsx" src/app/portal/activity/page.tsx src/app/portal/devices/page.tsx src/app/portal/login/page.tsx src/app/portal/tos/page.tsx tests/unit/components/portal-account.test.tsx docs/superpowers/plans/2026-07-11-wp-f2-portal-account.md
git commit -m "feat(wp-f.2): Portal Account + sign-out; lead-detail/login/ToS finish (h1s, 44px targets)"
```

---

## Self-Review (plan vs. decisions)
- Account page + FIRST portal sign-out (AUT-14) → Task 1 ✓
- Lead detail light polish (NO contact actions, per owner), h1, max-w, 13px → Task 2 ✓
- Login/ToS ≥44px buttons + h1 → Task 3 ✓
- One h1 per page + drop inert max-w-2xl across portal pages → Tasks 1–3 ✓
- Frontend-only (reuses /api/me + /api/auth/logout) → whole plan ✓

**Deferred:** territory map/chip/eyebrow + New count (backend); shared bell/theme/NotesPanel touch targets (app-wide); `statusPillClass` helper.

**Placeholder scan:** none. **Type consistency:** `PortalAccount()` matches the page import; `Me` matches `/api/me`'s `{email, role, workspace:{name}}`.
