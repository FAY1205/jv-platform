# WP-E / WS-6 — Rules page reskin + new `Switch` primitive

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the (already R3-functional) Rules page to the "Survey" design system and introduce a reusable `Switch` primitive (on-state = marigold), swapping the per-phrase `Checkbox` → `Switch`.

**Architecture:** One new hand-rolled component (`Switch.tsx`, a native `<button role="switch">` — no new dependency, mirrors the `SegmentedControl` precedent and mockup 13 exactly). The Rules page splits into an `AppShell`-wrapped `RulesBody` that pushes its title to the topbar via `usePageHeader`, and a presentational sibling module `mls-phrases.tsx` (`MlsPhrasesCard` + `LockedNote`) that both the real page and a throwaway screenshot route render with the real component.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query, Tailwind v4 (semantic tokens via `@/lib/cn`), Vitest + Testing Library, Playwright MCP for screenshots.

## Global Constraints

- **PRN-12:** no hardcoded hex/font/logo/product name in component code — consume semantic tokens only (Tailwind classes backed by `--*` vars).
- **PRN-14:** never convey information by color alone — the effect badges carry TEXT ("Keeps lead" / "Removes lead"); keep them.
- **PRN-04:** MLS regex stays read-only at runtime — the page only ever *displays* `regex`, never edits it. No pipeline/MLS-corpus changes in this WP.
- **PRN-15:** server data via TanStack Query only; no copying server data into component state (the real page). The throwaway preview route uses local mock state — it is deleted before commit and ships nothing.
- **DSN-03:** every interactive component implements default/hover/focus-visible/active/disabled (+ loading where applicable) states. `Switch` toggle is synchronous → `loading` n/a (same rationale as `SegmentedControl`).
- **MLS-02:** keep-override phrases render BEFORE disqualifiers (already enforced by `groupMlsPatterns` in `src/lib/mls-groups.ts` — do not reorder).
- **No new dependencies without an ADR** — `Switch` is hand-rolled; nothing added to `package.json`.
- **Test names carry requirement IDs**, e.g. `it("DSN-03: click reports the toggled value")`.
- **Sub-13px chrome floor (WP-C):** bump `.66rem`/`text-xs` chrome introduced or touched here to 13px.
- **ONE commit for the whole WP** (brief), placed AFTER the owner walkthrough. Tasks 1–3 end at "tests green", NOT at a commit.
- **Env/tooling:** run unit tests SERIALLY — `pnpm test:unit -- --no-file-parallelism` (jsdom OOM otherwise); always `pnpm typecheck` separately; lint only the CHANGED files (repo-wide `pnpm lint` has pre-existing errors from a stale `.claude/worktrees/*/.next` copy).

---

## File Structure

- **Create** `src/components/Switch.tsx` — the primitive. One responsibility: a controlled on/off switch.
- **Modify** `src/components/index.ts` — barrel-export `Switch` + `SwitchProps`.
- **Create** `src/app/rules/mls-phrases.tsx` — presentational `MlsPhrasesCard` (grouped tables + Switches) and `LockedNote` pill, plus the `MlsPhrase` type and `EFFECT_META` copy moved out of the page. Consumed by both the real page and the screenshot route.
- **Modify** `src/app/rules/page.tsx` — `RulesInner → <AppShell><RulesBody/></AppShell>`; `RulesBody` owns the query/mutation + `usePageHeader` + lede + `<LockedNote/>` + `<MlsPhrasesCard/>`. In-body `<h1>` removed.
- **Modify** `tests/unit/components/components.test.tsx` — add `describe("DSN-03: Switch")`.
- **Modify** `src/app/gallery/page.tsx` — add a Switch demo card (all states + live toggle).
- **Create (throwaway, deleted before commit)** `src/app/gallery/rules-preview/page.tsx` — mock-data render of the reskinned Rules body for two-theme Playwright screenshots.

---

## Task 1: `Switch` primitive (TDD)

**Files:**
- Test: `tests/unit/components/components.test.tsx` (add a `describe` block; import `Switch` from `@/components`)
- Create: `src/components/Switch.tsx`
- Modify: `src/components/index.ts`

**Interfaces:**
- Produces: `Switch` component + `SwitchProps`:
  ```ts
  interface SwitchProps {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label?: React.ReactNode;   // optional visible label, associated via aria-labelledby
    disabled?: boolean;
    id?: string;
    className?: string;
    ariaLabel?: string;        // accessible name when no visible label
  }
  ```

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `tests/unit/components/components.test.tsx` (extend the existing `@/components` import list with `Switch`). Then append:

```tsx
describe("DSN-03: Switch", () => {
  it("DSN-03: exposes role=switch with aria-checked reflecting state", () => {
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={() => {}} ariaLabel="Sold or pending listings" />,
    );
    const sw = screen.getByRole("switch", { name: "Sold or pending listings" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    rerender(<Switch checked onCheckedChange={() => {}} ariaLabel="Sold or pending listings" />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("DSN-03: click reports the toggled value", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} ariaLabel="Auction and short sale" />);
    await user.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("DSN-03: keyboard (Space) toggles", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked onCheckedChange={onCheckedChange} ariaLabel="No-contact instructions" />);
    screen.getByRole("switch").focus();
    await user.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("DSN-03: disabled blocks toggle", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} ariaLabel="Off-market or withdrawn" disabled />);
    const sw = screen.getByRole("switch");
    expect(sw).toBeDisabled();
    await user.click(sw);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("associates a visible label via aria-labelledby", () => {
    render(<Switch checked onCheckedChange={() => {}} label="In-app alerts" />);
    expect(screen.getByRole("switch", { name: "In-app alerts" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:unit -- --no-file-parallelism -t "DSN-03: Switch"`
Expected: FAIL — `Switch` is not exported from `@/components` (import/type error).

- [ ] **Step 3: Write the `Switch` implementation**

Create `src/components/Switch.tsx`:

```tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// Switch (DSN-03) — a controlled on/off toggle for a single boolean (e.g. whether an
// MLS filter phrase runs). Hand-rolled on a native <button role="switch"> — the ARIA
// switch pattern — so Space/Enter toggle come for free and no new dependency is added
// (mirrors SegmentedControl; ADR-0016's Radix primitives aren't needed for this).
// On-state is the marigold brand FILL (WP-C intent: "toggle switches, on-state=route").
// All colors are tokens (PRN-12). `loading` is n/a — a toggle is synchronous; the
// consuming page owns any async state (same as SegmentedControl).

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Optional visible label, placed after the control and bound via aria-labelledby. */
  label?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Accessible name when no visible `label` is provided. */
  ariaLabel?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, id, className, ariaLabel }: SwitchProps) {
  const autoId = React.useId();
  const switchId = id ?? autoId;
  const labelId = label ? `${switchId}-label` : undefined;

  const control = (
    <button
      type="button"
      role="switch"
      id={switchId}
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group relative inline-flex h-[26px] w-11 shrink-0 rounded-full border outline-none transition-colors",
        "focus-visible:ring-1 focus-visible:ring-brand-ink",
        "disabled:pointer-events-none disabled:opacity-60",
        checked
          ? "border-brand-strong bg-brand hover:bg-brand-strong"
          : "border-border-strong bg-surface-3 hover:border-text-3",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow-sm",
          "transition-transform duration-200 ease-out group-active:scale-90",
          checked ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );

  if (!label) return control;
  return (
    <span className={cn("inline-flex items-center gap-2.5", disabled && "opacity-60")}>
      {control}
      <span id={labelId} className="text-sm text-text">
        {label}
      </span>
    </span>
  );
}
```

Then add to `src/components/index.ts` (next to the `Checkbox` export):

```ts
export { Switch, type SwitchProps } from "./Switch";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:unit -- --no-file-parallelism -t "DSN-03: Switch"`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 2: Switch in `/gallery`

**Files:**
- Modify: `src/app/gallery/page.tsx`

**Interfaces:**
- Consumes: `Switch` from `@/components` (Task 1).

- [ ] **Step 1: Add local state + import**

In `src/app/gallery/page.tsx`, add `Switch` to the `@/components` import list. Inside `Gallery()`, next to the `checkA`/`checkB` state, add:

```tsx
const [switchA, setSwitchA] = React.useState(true);
const [switchB, setSwitchB] = React.useState(false);
```

- [ ] **Step 2: Add the demo card**

Immediately after the existing `Checkbox` demo `<Card>` (inside the "Foundation primitives — REDESIGN-R3 WS-1" grid), insert:

```tsx
<Card>
  <CardHeader><CardTitle>Switch (on-state = route)</CardTitle></CardHeader>
  <CardBody className="flex flex-col gap-3">
    <Switch checked={switchA} onCheckedChange={setSwitchA} label="Sold or pending listings" />
    <Switch checked={switchB} onCheckedChange={setSwitchB} label="Auction & short-sale" />
    <Switch checked disabled onCheckedChange={() => {}} label="Disabled — on" />
    <Switch checked={false} disabled onCheckedChange={() => {}} label="Disabled — off" />
  </CardBody>
</Card>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 3: Rules page reskin

**Files:**
- Create: `src/app/rules/mls-phrases.tsx`
- Modify: `src/app/rules/page.tsx`

**Interfaces:**
- Consumes: `Switch` (Task 1); `groupMlsPatterns`, `MlsEffect` from `@/lib/mls-groups`; `usePageHeader`, `AppShell` from `@/components`.
- Produces (from `mls-phrases.tsx`):
  ```ts
  interface MlsPhrase { id: string; patternKey: string; type: MlsEffect; regex: string; flags: string; label: string; enabled: boolean }
  function LockedNote(): JSX.Element
  interface MlsPhrasesCardProps { patterns: MlsPhrase[]; onToggle: (id: string, enabled: boolean) => void; pendingId?: string | null }
  function MlsPhrasesCard(props: MlsPhrasesCardProps): JSX.Element
  ```

- [ ] **Step 1: Create the presentational module**

Create `src/app/rules/mls-phrases.tsx`:

```tsx
"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardBody, Table, THead, TBody, Th, Tr, Td, Badge, Switch, EmptyState } from "@/components";
import { groupMlsPatterns, type MlsEffect } from "@/lib/mls-groups";

// WS-6 · the MLS filter-phrases card. Phrases are view + on/off + label (never regex,
// PRN-04); grouped by effect with keep-override first (it wins, MLS-02). The effect is
// always conveyed by group title + badge TEXT, never color alone (PRN-14). Presentational
// only — the page owns the query + toggle mutation; this component also backs the
// throwaway two-theme screenshot route, so it takes plain data + callbacks.

export interface MlsPhrase {
  id: string;
  patternKey: string;
  type: MlsEffect;
  regex: string;
  flags: string;
  label: string;
  enabled: boolean;
}

const EFFECT_META: Record<MlsEffect, { title: string; hint: string; badge: "success" | "removed"; badgeLabel: string }> = {
  keep_override: {
    title: "Keep-override phrases",
    hint: "These win over everything — a lead matching one is kept even if a disqualify phrase also matches.",
    badge: "success",
    badgeLabel: "Keeps lead",
  },
  disqualify: {
    title: "Disqualify phrases",
    hint: "A lead whose notes match one of these is removed as on-market — unless a keep-override phrase also matches.",
    badge: "removed",
    badgeLabel: "Removes lead",
  },
};

export function LockedNote() {
  return (
    <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 text-[13px] text-text-3">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      Pattern text is locked in code — toggle whether each one runs.
    </span>
  );
}

export interface MlsPhrasesCardProps {
  patterns: MlsPhrase[];
  onToggle: (id: string, enabled: boolean) => void;
  pendingId?: string | null;
}

export function MlsPhrasesCard({ patterns, onToggle, pendingId }: MlsPhrasesCardProps) {
  return (
    <Card>
      <CardHeader><CardTitle>MLS phrases</CardTitle></CardHeader>
      <CardBody>
        {patterns.length === 0 ? (
          <EmptyState title="No MLS phrases" description="No filter phrases are configured yet." />
        ) : (
          <div className="flex flex-col gap-6">
            {groupMlsPatterns(patterns).map((group) => {
              const meta = EFFECT_META[group.effect];
              return (
                <section key={group.effect} className="flex flex-col gap-2">
                  <div id={`mls-group-${group.effect}`} className="flex items-center gap-2">
                    <Badge variant={meta.badge}>{meta.badgeLabel}</Badge>
                    <h3 className="text-sm font-semibold text-text">{meta.title}</h3>
                  </div>
                  <p className="text-[13px] text-text-3">{meta.hint}</p>
                  {/* Tie the table to its effect header so AT users hear which group it is (WCAG 1.3.1). */}
                  <Table aria-labelledby={`mls-group-${group.effect}`}>
                    <THead><Tr><Th>Phrase</Th><Th>Key</Th><Th align="right">On</Th></Tr></THead>
                    <TBody>
                      {group.patterns.map((m) => (
                        <Tr key={m.id}>
                          <Td>
                            <div className="text-sm text-text">{m.label}</div>
                            <div className="num text-[13px] text-text-3">{m.regex}</div>
                          </Td>
                          <Td><span className="num text-[13px] text-text-3">{m.patternKey}</span></Td>
                          <Td align="right">
                            <div className="inline-flex justify-end">
                              <Switch
                                checked={m.enabled}
                                disabled={pendingId === m.id}
                                onCheckedChange={(v) => onToggle(m.id, v)}
                                ariaLabel={`${m.label} enabled`}
                              />
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </section>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Rewrite `page.tsx` to consume it + move title to topbar**

Replace the entire contents of `src/app/rules/page.tsx` with:

```tsx
"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, Skeleton, EmptyState, ToastProvider, useToast, AppShell, usePageHeader } from "@/components";
import { LockedNote, MlsPhrasesCard, type MlsPhrase } from "./mls-phrases";

// WS-6 · CVG-02: the Rules area — MLS filter phrases only. Phrases are view + on/off +
// label (never regex, PRN-04). The exact matching is vetted and tested, so the wording
// here can't change how a phrase matches — surfaced to the user via the locked-note pill.
// Coverage moved to Partners (WS-5); recodes removed (ADR-0018). Every change is audited
// and picked up by the next run (DM-08). The toggle touches only ["rules"] — no
// coverage/dashboard cache is involved.

interface RulesData { mlsPatterns: MlsPhrase[] }

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: body === undefined ? "{}" : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string }).message ?? "Request failed");
  return json;
}

function RulesBody() {
  usePageHeader({ title: "Rules" });
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isPending, error } = useQuery({ queryKey: ["rules"], queryFn: () => apiGet<RulesData>("/api/admin/rules") });

  const toggleMls = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => send(`/api/admin/rules/mls/${v.id}`, "PATCH", { enabled: v.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    onError: (e: Error) => toast(e.message, "danger"),
  });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <p className="text-sm text-text-2">MLS filter phrases decide which listings are removed before routing. Changes apply to future runs and are logged.</p>
        <LockedNote />
      </div>

      {error ? (
        <Card><CardBody><EmptyState title="Couldn't load rules" description={(error as Error).message} /></CardBody></Card>
      ) : isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <MlsPhrasesCard
          patterns={data.mlsPatterns}
          onToggle={(id, enabled) => toggleMls.mutate({ id, enabled })}
          pendingId={toggleMls.isPending ? toggleMls.variables?.id ?? null : null}
        />
      )}
    </div>
  );
}

export default function RulesPage() {
  return (
    <ToastProvider>
      <AppShell>
        <RulesBody />
      </AppShell>
    </ToastProvider>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full unit suite (serial)**

Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green (prior baseline + the 5 new Switch tests).

- [ ] **Step 5: Lint the changed files**

Run: `pnpm exec eslint src/components/Switch.tsx src/components/index.ts src/app/rules/page.tsx src/app/rules/mls-phrases.tsx src/app/gallery/page.tsx`
Expected: no errors.

---

## Task 4: Screenshots · self-review · single commit

**Files:**
- Create (throwaway): `src/app/gallery/rules-preview/page.tsx`
- Delete before commit: same file.

- [ ] **Step 1: Create the throwaway two-theme preview route**

Create `src/app/gallery/rules-preview/page.tsx` (public per `src/proxy.ts` — `/gallery` is not protected):

```tsx
"use client";

import * as React from "react";
import { LockedNote, MlsPhrasesCard, type MlsPhrase } from "@/app/rules/mls-phrases";

const MOCK: MlsPhrase[] = [
  { id: "1", patternKey: "sold_pending", type: "keep_override", regex: "/\\bkeep\\b/i", flags: "i", label: "Owner asked to keep", enabled: true },
  { id: "2", patternKey: "sold_status", type: "disqualify", regex: "/\\b(sold|pending|closed)\\b/i", flags: "i", label: "Sold or pending listings", enabled: true },
  { id: "3", patternKey: "off_market", type: "disqualify", regex: "/\\b(withdrawn|cancell?ed|expired)\\b/i", flags: "i", label: "Off-market / withdrawn", enabled: true },
  { id: "4", patternKey: "auction", type: "disqualify", regex: "/\\b(auction|short[- ]sale)\\b/i", flags: "i", label: "Auction & short-sale", enabled: false },
];

export default function RulesPreview() {
  const [patterns, setPatterns] = React.useState(MOCK);
  React.useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  }, []);
  return (
    <div className="min-h-screen bg-bg p-10 text-text">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div>
          <h1 className="font-display text-lg font-semibold tracking-tight text-text">Rules</h1>
          <p className="mt-1 text-sm text-text-2">MLS filter phrases decide which listings are removed before routing. Changes apply to future runs and are logged.</p>
          <LockedNote />
        </div>
        <MlsPhrasesCard patterns={patterns} onToggle={(id, enabled) => setPatterns((p) => p.map((x) => (x.id === id ? { ...x, enabled } : x)))} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Start the dev server + screenshot both themes**

Start the "web" dev server (`preview_start` name `"web"`, port 3000). With the Playwright MCP, navigate to `http://localhost:3000/gallery/rules-preview?t=light` and `...?t=dark`; capture a full-page screenshot of each. Verify: title reads "Rules"; the padlock pill renders under the lede; two effect groups (Keeps lead / Removes lead) with text badges; switches show marigold ON fill and grey OFF; the last row (Auction) is OFF; regex + key are ≥13px; no console errors. Also click a Switch to confirm it toggles the fill.

- [ ] **Step 3: Print the PLAYBOOK §6 self-audit checklist**

Fill in every line (n/a where it doesn't apply — never delete). Expected notable lines: PRN-12 ✓ (tokens only), PRN-15 ✓ (real page uses Query; preview is throwaway), DSN-03 ✓ (Switch full state matrix + gallery), PRN-04 ✓ (regex display-only), "Only WP-scope files touched" ✓.

- [ ] **Step 4: Self-review the diff with agents**

Dispatch, in parallel, on the working-tree diff:
- `pr-reviewer` — correctness / spec conformance / process.
- `audit-design-system` — token discipline, state completeness, theme parity (new primitive).
- `audit-a11y` — the new interactive primitive (role=switch, name, keyboard, focus, contrast of the marigold ON fill).

Address every finding (fix inline, or record as a deferred WP candidate with rationale). Re-run `pnpm typecheck` + the serial unit suite after fixes.

- [ ] **Step 5: Delete the throwaway preview route**

```bash
rm -rf src/app/gallery/rules-preview
```
Run `pnpm typecheck` again to confirm nothing referenced it.

- [ ] **Step 6: Owner walkthrough**

Present the two-theme screenshots to the owner. Wait for approval BEFORE committing.

- [ ] **Step 7: ONE commit (after approval)**

```bash
git add src/components/Switch.tsx src/components/index.ts src/app/rules/page.tsx src/app/rules/mls-phrases.tsx src/app/gallery/page.tsx tests/unit/components/components.test.tsx docs/superpowers/plans/2026-07-11-wp-e-ws6-rules.md
git commit -m "feat(wp-e/ws-6): Rules — Survey reskin + new Switch primitive (on-state=route)"
```

---

## Self-Review (plan vs. brief/spec)

**Spec coverage:**
- New `Switch` primitive (role=switch, aria-checked, on=marigold, full DSN-03 matrix, keyboard, tokens, barrel export, gallery, test) → Tasks 1–2. ✓
- Swap phrase `Checkbox` → `Switch` → Task 3. ✓
- Title → topbar (usePageHeader, RulesInner → body in AppShell) → Task 3. ✓
- Locked-note pill w/ lock icon → Task 3 (`LockedNote`). ✓
- Bump sub-13px chrome (.66rem regex + key) → 13px → Task 3. ✓
- KEEP grouped-by-effect, keep-override-first, effect badges, aria-labelledby wiring, PRN-04 read-only → Task 3 (structure preserved from original; `groupMlsPatterns` unchanged). ✓
- `["rules"]`-only invalidation preserved → Task 3. ✓
- Two-theme Playwright screenshots via throwaway public route, deleted pre-commit → Task 4. ✓
- Self-review (PLAYBOOK §6 + pr-reviewer + audit-design-system + audit-a11y) → Task 4. ✓
- Owner walkthrough before ONE commit → Task 4. ✓

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `MlsPhrase` defined in `mls-phrases.tsx`, imported by `page.tsx` (`RulesData.mlsPatterns`) and the preview route; `MlsPhrasesCardProps.onToggle(id, enabled)` matches the page's `toggleMls.mutate` call; `pendingId` nullable and passed as `variables?.id ?? null`. `SwitchProps` used identically in gallery, card, and tests.

**Out of scope (mockup↔app deltas, deliberately excluded):** per-phrase hit counts (no data source, demo fiction), mockup topic-grouping (brief keeps effect grouping), mockup div-rows (brief keeps `<Table>`).
