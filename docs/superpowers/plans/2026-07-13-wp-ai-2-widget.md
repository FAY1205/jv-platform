# WP-AI-2 — AI Assistant Widget + Settings UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the visible half of Phase B — a floating bottom-right admin chat widget (theme-aware plasma-orb launcher + 400×640 panel, streaming answers, contextual chips, source chips, deep links, thumbs, budget-cap state) mounted in `AppShell`, plus the `Settings → AI assistant` section (enable switch, monthly cap, month-to-date usage in $).

**Architecture:** Client-only widget lazy-loaded (`next/dynamic`, `ssr:false`) at the `AppShell` boundary (admin surface only, keeps AI deps out of the base bundle). Chat via `@ai-sdk/react`@3 `useChat` + a `DefaultChatTransport` whose custom `fetch` echoes CSRF, injects the current `screen`, and intercepts the non-OK `{code}` envelope to drive cap/rate/disabled UI states. Every rendered figure/source/deep-link comes from the streamed message parts — never model claims. All styling consumes Survey semantic tokens (PRN-12); the mockup's bespoke elevation vocabulary is reconciled onto the app's `--sh-*` scale plus three additive glow/shadow tokens.

**Tech Stack:** Next 16 (App Router, TS), React, `ai`@6 + `@ai-sdk/react`@3 (ADR-0027, already installed), TanStack Query v5, Tailwind v4 (CSS-first tokens), Zod v4, Vitest + jsdom, Playwright MCP.

**Reference mockup (approved rev-7):** `<session scratchpad>/ai-widget-mockup.html` (artifact `35796b7b`). It is the visual source of truth; port its CSS to Tailwind + tokens. Design doc: `docs/superpowers/specs/2026-07-13-ai-assistant-design.md` (§3 architecture, §4 tools, §7 PII/link-whitelist, widget-UX row). ADR-0027 (+Amendment 1) for the stack.

## Global Constraints

- **PRN-12 (token discipline):** no hardcoded hex, font, logo, or product name in component code — consume Survey semantic tokens (`src/lib/tokens` / Tailwind `bg-*`/`text-*`/`border-*`/`shadow-*` utilities / `var(--token)`). Reuse `--sh-xs/sm/md/lg`; the only new tokens are `--halo`, `--sh-amb`, `--sh-up` (Task 1).
- **PRN-10 / AIA-05 (deep-link whitelist):** a source deep link renders **only** when `isInternalPath(path)` returns true (from `src/modules/ai/prompt.ts`). Anything else renders as plain text. Never trust a model-authored URL.
- **AIA-03 (grounded UI):** source chips + the single deep link are derived from **actual tool-part outputs** (`part.output.source` / `part.output.path`), not model text.
- **Widget shows NO dollar amounts.** Budget state = an allowance band + disabled input only. All $ figures live in `Settings → AI assistant`.
- **Server data via TanStack Query + `useChat` only (spec §6.17).** Never copy server data into component state. The one allowed local UI state is transient widget chrome (open/closed, input draft, cap flag, per-message thumb-pressed).
- **DSN-03:** every interactive element implements default / hover / focus-visible / active / disabled / loading states.
- **PRN-14:** never convey meaning by color alone — source chips carry a text label; the deep link carries text; the live dot is decorative (`aria-hidden`).
- **Reduced-motion + tab-hidden safe:** the orb pauses its rAF loop when `document.hidden`; under `prefers-reduced-motion: reduce` it draws one static frame (no loop, no launcher breathe).
- **No new dependencies without an ADR.** `ai` + `@ai-sdk/react` are already covered by ADR-0027. The answer renderer is a no-dep formatter (no markdown library).
- **CSRF:** every state-changing fetch echoes `csrfHeaders()` (`src/lib/csrf-client.ts`). The chat + feedback routes are `assertCsrf(..., { requireToken: true })`.
- **Test naming carries requirement IDs:** e.g. `it("PRN-10: renders a deep link only for an internal path", …)`.
- **Vitest runs SERIAL:** `pnpm test:unit -- --no-file-parallelism` (jsdom OOM otherwise). `pnpm typecheck` separately. Lint CHANGED files only.
- **Cadence — ONE commit per WP.** Do **not** commit per task. Execute all tasks in-session leaving green tests; stage everything and make a SINGLE commit only after explicit owner "go" (Task 13), and push only after a separate owner "go".
- **`@ai-sdk/react`@3 / `ai`@6 gotchas (verified against installed types):** `useChat` no longer manages input — use local `useState` + `sendMessage({ text })`; transport is `new DefaultChatTransport({ api, headers, fetch, prepareSendMessagesRequest })`; render `message.parts`; tool parts are matched with `isToolUIPart(part)` + `getToolName(part)` and read at `part.state === "output-available"` via `part.output`; `useChat` returns `{ messages, status, error, sendMessage, setMessages, clearError, stop }`.

---

## File Structure

**New — pure logic (`src/modules/ai/`):**
- `screen.ts` — `screenForPath(pathname): ScreenKey | undefined` (route → screen catalog key).
- `format-answer.ts` — `formatAnswer(text): AnswerBlock[]` (no-dep bold / dash-bullet / ref-mono formatter).
- `gate-error.ts` — `gateStateFromCode(code): AssistantGate | null` (envelope code → cap/rate/disabled UI state).

**New — components (`src/components/assistant/`), all `"use client"`, NOT exported from the barrel (kept out of the base bundle):**
- `Orb.tsx` — canvas plasma-orb renderer (`{ size, animate }`).
- `SuggestionChips.tsx` — contextual chip row (`{ items, onSelect, disabled }`).
- `AnswerBody.tsx` — renders `formatAnswer` output (bold/bullets/mono refs).
- `AssistantMessage.tsx` — one assistant turn: `AnswerBody` + source chips + one guarded deep link + thumbs.
- `AssistantWidget.tsx` — orchestrator: launcher + panel + `useChat` + transport + cap state + `usePathname`→screen. The only stateful file.

**New — settings (`src/app/settings/ai/`):**
- `page.tsx` — server wrapper (`SettingsSection` + `<AiSettings/>`).
- `ai-settings.tsx` — `"use client"` — GET/PUT `/api/settings/ai` via TanStack Query; Switch + cap Input + usage $.

**Modified:**
- `src/app/globals.css` — add `--halo`, `--sh-amb`, `--sh-up` (both themes) + `@theme` `--shadow-amb`/`--shadow-up` + `@keyframes assistant-breathe` + `.assistant-breathe`.
- `src/lib/tokens/tokens.ts` — add `amb`/`up` to the `elevation` map (hygiene mirror).
- `tests/unit/tokens.test.ts` — assert the 3 new vars + 2 mappings exist (regression gate).
- `src/components/AppShell.tsx` — lazy-mount `AssistantWidget` after `<main>`.
- `src/app/settings/settings-nav.tsx` — add `{ href: "/settings/ai", label: "AI assistant" }` to the Organization group.

**Throwaway (deleted before commit):**
- `src/app/gallery/assistant/page.tsx` — renders the presentational panel with fixtures for screenshots (both themes, all states). Public route (not in `PROTECTED_PAGE_PREFIXES`).

---

## Task 1: Additive elevation/glow tokens

**Files:**
- Modify: `src/app/globals.css` (`:root`, the `@media (prefers-color-scheme: dark)` block, the `:root[data-theme="dark"]` block, `@theme inline`, and the motion/keyframes area)
- Modify: `src/lib/tokens/tokens.ts:159-164` (the `elevation` map)
- Test: `tests/unit/tokens.test.ts`

**Interfaces:**
- Produces: CSS vars `--halo`, `--sh-amb`, `--sh-up`; Tailwind utilities `shadow-amb`, `shadow-up`; a `.assistant-breathe` class. Consumed by Task 5 (launcher) + Task 8 (panel footer).

- [ ] **Step 1: Write the failing test** — append to `tests/unit/tokens.test.ts` inside the `describe("DSN-01/SEAM-08: design tokens", …)` block:

```ts
it("WP-AI-2: declares the additive assistant elevation/glow tokens in both themes", () => {
  // --halo (orb glow), --sh-amb (launcher ambient), --sh-up (footer top-shadow).
  for (const v of ["--halo", "--sh-amb", "--sh-up"]) {
    // once in :root (light) + once in each dark block ⇒ ≥3 declarations.
    const count = globalsCss.split(`${v}:`).length - 1;
    expect(count, `${v} should be declared in light + both dark blocks`).toBeGreaterThanOrEqual(3);
  }
  expect(globalsCss).toContain("--shadow-amb:");
  expect(globalsCss).toContain("--shadow-up:");
  expect(globalsCss).toContain("@keyframes assistant-breathe");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/tokens.test.ts`
Expected: FAIL (tokens not yet in globals.css).

- [ ] **Step 3: Add the raw tokens to all three colour blocks in `globals.css`.**

In `:root { … }` after the `/* elevation 0–3 */` shadow lines (~line 55) add:

```css
  /* assistant widget (WP-AI-2): orb glow + ambient/upward shadows */
  --halo: rgba(224, 145, 43, 0.35);
  --sh-amb: 0 8px 20px rgba(22, 36, 43, 0.2);
  --sh-up: 0 -2px 10px rgba(22, 36, 43, 0.05);
```

In the `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` block after its `--sh-lg` line (~line 104) add:

```css
    --halo: rgba(240, 166, 62, 0.28);
    --sh-amb: 0 8px 22px rgba(0, 0, 0, 0.55);
    --sh-up: 0 -2px 10px rgba(0, 0, 0, 0.35);
```

In the `:root[data-theme="dark"] { … }` block after its `--sh-lg` line (~line 142) add the identical three dark lines.

- [ ] **Step 4: Map the two shadows to Tailwind utilities.** In `@theme inline { … }` after `--shadow-lg: var(--sh-lg);` (~line 185) add:

```css
  --shadow-amb: var(--sh-amb);
  --shadow-up: var(--sh-up);
```

- [ ] **Step 5: Add the launcher breathe keyframe.** In `globals.css` after the `.anim-drawer` rule (~line 302) add:

```css
/* Assistant launcher: a slow ambient pulse (halo grows/shrinks). The global
   reduced-motion rule below collapses this to a static shadow. */
@keyframes assistant-breathe {
  0%, 100% { box-shadow: var(--sh-amb), 0 4px 18px var(--halo); }
  50%      { box-shadow: var(--sh-amb), 0 6px 32px var(--halo); }
}
.assistant-breathe { animation: assistant-breathe 4.5s ease-in-out infinite; }
```

(No extra reduced-motion handling needed — the existing `@media (prefers-reduced-motion: reduce)` block already forces `animation-iteration-count: 1` and near-zero duration globally.)

- [ ] **Step 6: Mirror the two shadows in `tokens.ts`** (hygiene — the elevation map is the off-CSS mirror). Change the `elevation` object (`src/lib/tokens/tokens.ts:159`) to add two members (light values; dark values live in CSS like the other `--sh-*`):

```ts
/** Elevation levels 0–3 + assistant ambient/upward (WP-AI-2) — subtle, no heavy drops (DSN-01). */
export const elevation = {
  xs: "0 1px 2px rgba(15,23,34,.04)",
  sm: "0 1px 2px rgba(15,23,34,.05),0 1px 3px rgba(15,23,34,.04)",
  md: "0 4px 12px rgba(15,23,34,.07),0 1px 3px rgba(15,23,34,.05)",
  lg: "0 16px 40px rgba(15,23,34,.14),0 4px 12px rgba(15,23,34,.08)",
  amb: "0 8px 20px rgba(22,36,43,.2)",
  up: "0 -2px 10px rgba(22,36,43,.05)",
} as const;
```

- [ ] **Step 7: Run the token tests green**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/tokens.test.ts`
Expected: PASS (all existing token assertions + the new one).

---

## Task 2: `screenForPath` pure helper

**Files:**
- Create: `src/modules/ai/screen.ts`
- Test: `tests/unit/ai-screen.test.ts`

**Interfaces:**
- Consumes: `ScreenKey`, `SCREEN_KEYS` from `src/modules/ai/prompt.ts`.
- Produces: `screenForPath(pathname: string): ScreenKey | undefined`. Consumed by Task 8 (`AssistantWidget`) for both `suggestionsFor(screen)` and the `screen` chat-body field.

- [ ] **Step 1: Write the failing test** — `tests/unit/ai-screen.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { screenForPath } from "@/modules/ai/screen";

describe("WP-AI-2 screenForPath", () => {
  it("maps the dashboard root and /dashboard", () => {
    expect(screenForPath("/")).toBe("dashboard");
    expect(screenForPath("/dashboard")).toBe("dashboard");
  });
  it("maps list pages", () => {
    expect(screenForPath("/leads")).toBe("leads");
    expect(screenForPath("/unmatched")).toBe("unmatched");
    expect(screenForPath("/partners")).toBe("partners");
    expect(screenForPath("/coverage")).toBe("coverage");
    expect(screenForPath("/rules")).toBe("rules");
    expect(screenForPath("/activity")).toBe("activity");
    expect(screenForPath("/upload")).toBe("upload");
  });
  it("maps detail pages to their detail screen", () => {
    expect(screenForPath("/imports")).toBe("imports");
    expect(screenForPath("/imports/IM-26-004")).toBe("import_detail");
    expect(screenForPath("/partners/abc-123")).toBe("partner_detail");
  });
  it("maps a lead detail to the leads screen (no lead_detail catalog key)", () => {
    expect(screenForPath("/leads/LD-26-00042")).toBe("leads");
  });
  it("maps any settings sub-page to settings", () => {
    expect(screenForPath("/settings")).toBe("settings");
    expect(screenForPath("/settings/ai")).toBe("settings");
  });
  it("returns undefined for unknown or non-app routes", () => {
    expect(screenForPath("/gallery/assistant")).toBeUndefined();
    expect(screenForPath("/portal/leads")).toBeUndefined();
    expect(screenForPath("")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/ai-screen.test.ts`
Expected: FAIL ("screenForPath is not a function" / module missing).

- [ ] **Step 3: Implement `src/modules/ai/screen.ts`:**

```ts
import type { ScreenKey } from "./prompt";

// Map the current admin route to a screen-catalog key (design §4: "explain this
// screen" + contextual chips). Detail routes get their *_detail key; a lead detail
// has no catalog key so it degrades to the leads screen. Pure — no window/router.
export function screenForPath(pathname: string): ScreenKey | undefined {
  const path = pathname.split("?")[0].split("#")[0];
  if (path === "/" || path === "/dashboard") return "dashboard";
  const seg = path.split("/").filter(Boolean); // ["imports","IM-26-004"]
  const top = seg[0];
  const hasChild = seg.length > 1;
  switch (top) {
    case "leads": return "leads";
    case "unmatched": return "unmatched";
    case "imports": return hasChild ? "import_detail" : "imports";
    case "partners": return hasChild ? "partner_detail" : "partners";
    case "coverage": return "coverage";
    case "activity": return "activity";
    case "rules": return "rules";
    case "settings": return "settings";
    case "upload": return "upload";
    default: return undefined;
  }
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/ai-screen.test.ts`
Expected: PASS.

---

## Task 3: `formatAnswer` pure renderer helper

**Files:**
- Create: `src/modules/ai/format-answer.ts`
- Test: `tests/unit/ai-format-answer.test.ts`

**Interfaces:**
- Produces:
  - `type InlineSpan = { kind: "text" | "bold" | "ref"; text: string }`
  - `type AnswerBlock = { type: "p"; spans: InlineSpan[] } | { type: "ul"; items: InlineSpan[][] }`
  - `formatAnswer(text: string): AnswerBlock[]`
- Consumed by Task 4a (`AnswerBody.tsx`).

Rules: split into blocks by line; a line matching `^\s*[-–•*]\s+` is a bullet item (consecutive bullets group into one `ul`); blank lines separate paragraphs; everything else is a paragraph line (consecutive non-bullet lines join with a space into one `p`). Inline: `**bold**` → `bold` span; ref-IDs (`JV-###`, `LD-##-#####+`, `IM-##-###+`, `UP-####-###+`) → `ref` span; the rest → `text`.

- [ ] **Step 1: Write the failing test** — `tests/unit/ai-format-answer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatAnswer, type AnswerBlock } from "@/modules/ai/format-answer";

describe("WP-AI-2 formatAnswer", () => {
  it("returns a single paragraph for plain prose", () => {
    const b = formatAnswer("You have 7 active partners.");
    expect(b).toEqual<AnswerBlock[]>([{ type: "p", spans: [{ kind: "text", text: "You have 7 active partners." }] }]);
  });
  it("groups dash/•/* bullet lines into one list", () => {
    const b = formatAnswer("Top gaps:\n- California — 31 waiting\n– Arizona — 18 waiting\n* Nevada — 7 waiting");
    expect(b[0]).toEqual({ type: "p", spans: [{ kind: "text", text: "Top gaps:" }] });
    expect(b[1].type).toBe("ul");
    expect((b[1] as Extract<AnswerBlock, { type: "ul" }>).items).toHaveLength(3);
  });
  it("tokenizes **bold** spans", () => {
    const b = formatAnswer("**Meridian Buyers** is your top partner.");
    const p = b[0] as Extract<AnswerBlock, { type: "p" }>;
    expect(p.spans[0]).toEqual({ kind: "bold", text: "Meridian Buyers" });
    expect(p.spans[1]).toEqual({ kind: "text", text: " is your top partner." });
  });
  it("tokenizes ref IDs into mono spans", () => {
    const b = formatAnswer("Partner JV-003 and lead LD-26-00042 in import IM-26-004.");
    const kinds = (b[0] as Extract<AnswerBlock, { type: "p" }>).spans.filter((s) => s.kind === "ref").map((s) => s.text);
    expect(kinds).toEqual(["JV-003", "LD-26-00042", "IM-26-004"]);
  });
  it("does not treat a mid-word hyphen as a bullet", () => {
    const b = formatAnswer("first-pass match rate is 74%.");
    expect(b).toHaveLength(1);
    expect(b[0].type).toBe("p");
  });
  it("returns [] for empty/whitespace", () => {
    expect(formatAnswer("   ")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/ai-format-answer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/modules/ai/format-answer.ts`:**

```ts
// Pure no-dep renderer for streamed assistant text (design §6: plain language,
// dash bullets for 3+ numbers, mono refs). NOT a markdown engine — only the three
// things the system prompt actually emits: **bold**, dash/•/* bullets, ref IDs.
// The React layer renders these spans (no dangerouslySetInnerHTML).

export type InlineSpan = { kind: "text" | "bold" | "ref"; text: string };
export type AnswerBlock =
  | { type: "p"; spans: InlineSpan[] }
  | { type: "ul"; items: InlineSpan[][] };

const BULLET_RE = /^\s*[-–•*]\s+(.*)$/;
const REF_RE = /\b(JV-\d{3}|LD-\d{2}-\d{5,}|IM-\d{2}-\d{3,}|UP-\d{4}-\d{3,})\b/g;

/** Split a line into text/bold/ref spans. Bold is matched first, then refs inside
 *  each non-bold segment. */
function inlineSpans(line: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const boldRe = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string) => {
    if (!t) return;
    let idx = 0;
    let r: RegExpExecArray | null;
    REF_RE.lastIndex = 0;
    while ((r = REF_RE.exec(t))) {
      if (r.index > idx) spans.push({ kind: "text", text: t.slice(idx, r.index) });
      spans.push({ kind: "ref", text: r[0] });
      idx = r.index + r[0].length;
    }
    if (idx < t.length) spans.push({ kind: "text", text: t.slice(idx) });
  };
  while ((m = boldRe.exec(line))) {
    if (m.index > last) pushText(line.slice(last, m.index));
    spans.push({ kind: "bold", text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < line.length) pushText(line.slice(last));
  return spans;
}

export function formatAnswer(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", spans: inlineSpans(para.join(" ").trim()) });
      para = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushPara();
      const prev = blocks[blocks.length - 1];
      const item = inlineSpans(bullet[1].trim());
      if (prev && prev.type === "ul") prev.items.push(item);
      else blocks.push({ type: "ul", items: [item] });
    } else if (line.trim() === "") {
      flushPara();
    } else {
      para.push(line.trim());
    }
  }
  flushPara();
  return blocks;
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/ai-format-answer.test.ts`
Expected: PASS.

---

## Task 4: `gateStateFromCode` pure helper

**Files:**
- Create: `src/modules/ai/gate-error.ts`
- Test: `tests/unit/ai-gate-error.test.ts`

**Interfaces:**
- Produces:
  - `type AssistantGate = "budget" | "rate" | "disabled"`
  - `gateStateFromCode(code: string | undefined | null): AssistantGate | null`
- Consumed by Task 8 (transport `fetch` reads the non-OK envelope → widget cap/rate/disabled state).

- [ ] **Step 1: Write the failing test** — `tests/unit/ai-gate-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gateStateFromCode } from "@/modules/ai/gate-error";

describe("WP-AI-2 gateStateFromCode", () => {
  it("AIA-06: maps budget/rate/disabled envelope codes", () => {
    expect(gateStateFromCode("ai_budget_reached")).toBe("budget");
    expect(gateStateFromCode("ai_rate_limited")).toBe("rate");
    expect(gateStateFromCode("ai_disabled")).toBe("disabled");
  });
  it("returns null for unrelated / missing codes", () => {
    expect(gateStateFromCode("ai_chat_failed")).toBeNull();
    expect(gateStateFromCode("csrf_rejected")).toBeNull();
    expect(gateStateFromCode(undefined)).toBeNull();
    expect(gateStateFromCode(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/ai-gate-error.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/modules/ai/gate-error.ts`:**

```ts
// Map a chat-route error envelope `code` (src/lib/http.ts { code,message,traceId })
// to the widget's blocking state. Only these three disable the composer; every other
// error is a transient failure surfaced via useChat.error, not a persistent block.
export type AssistantGate = "budget" | "rate" | "disabled";

export function gateStateFromCode(code: string | undefined | null): AssistantGate | null {
  switch (code) {
    case "ai_budget_reached": return "budget";
    case "ai_rate_limited": return "rate";
    case "ai_disabled": return "disabled";
    default: return null;
  }
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/ai-gate-error.test.ts`
Expected: PASS.

---

## Task 5: `Orb.tsx` — canvas plasma orb

**Files:**
- Create: `src/components/assistant/Orb.tsx`
- Test: `tests/unit/assistant-orb.test.tsx`

**Interfaces:**
- Produces: `export function Orb(props: { size: number; animate?: boolean; className?: string }): JSX.Element`. Consumed by Task 8 (launcher Orb 52 + header Orb 34) and Task 7 (avatar Orb 24).

Port the mockup's `makeOrb` (lines 333–401) into a React component. Key behaviors to preserve:
- Theme-aware palette read at draw time from `document.documentElement.getAttribute("data-theme")` (fallback to `matchMedia("(prefers-color-scheme: dark)")`), honey-glass on paper / petrol-glass in dark, marigold ribbons + subtle white 0.38, NO purple, NO sparkle.
- `animate && !reduced-motion` → `requestAnimationFrame` loop that **skips drawing while `document.hidden`**; else one static draw.
- Redraw on theme change (subscribe to a `MutationObserver` on `<html data-theme>` + a `matchMedia("(prefers-color-scheme: dark)")` change listener), so a light/dark flip repaints static orbs.
- Guard `getContext("2d")` returning `null` (jsdom) — no throw.
- DPR-aware canvas sizing; `aria-hidden` wrapper.

- [ ] **Step 1: Write the failing test** — `tests/unit/assistant-orb.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Orb } from "@/components/assistant/Orb";

describe("WP-AI-2 Orb", () => {
  it("renders a decorative canvas at the requested CSS size without throwing (jsdom: null 2d ctx)", () => {
    const { container } = render(<Orb size={34} animate />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.style.width).toBe("34px");
    expect(canvas!.style.height).toBe("34px");
    // wrapper is decorative
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("renders a static orb (animate omitted) without throwing", () => {
    const { container } = render(<Orb size={24} />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/assistant-orb.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/components/assistant/Orb.tsx`.** Port the mockup renderer; wrap in `useEffect`. Full component:

```tsx
"use client";

import * as React from "react";

type Palette = {
  base1: string; base2: string; additive: boolean;
  ribbons: [string, number][];
  under: string; rim: string; arc: string; spec: string;
};

// Theme-aware glass palette — honey-glass on paper, petrol-glass in dark. Values are
// the approved mockup's (rev-7). Colours here are canvas paint (not DOM styling), so
// they live with the renderer; the DOM chrome around the orb uses tokens (PRN-12).
function orbPalette(): Palette {
  const attr = document.documentElement.getAttribute("data-theme");
  const dark = attr === "dark" || (attr !== "light" && typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  return dark
    ? { base1: "#1E2C33", base2: "#0B1114", additive: true,
        ribbons: [["#E0912B", 0.85], ["#F6B856", 0.7], ["#5FA0C8", 0.5], ["#FFFFFF", 0.45], ["#C67D1E", 0.6]],
        under: "rgba(95,160,200,.25)", rim: "rgba(255,255,255,.35)", arc: "rgba(255,255,255,.7)", spec: "rgba(255,255,255,.45)" }
    : { base1: "#FFF9EC", base2: "#EBCF9C", additive: false,
        ribbons: [["#E0912B", 0.8], ["#C67D1E", 0.65], ["#8F5416", 0.4], ["#2E6E93", 0.28], ["#FFFFFF", 0.38]],
        under: "rgba(46,110,147,.14)", rim: "rgba(143,84,22,.5)", arc: "rgba(255,255,255,.95)", spec: "rgba(255,255,255,.65)" };
}

export function Orb({ size, animate = false, className }: { size: number; animate?: boolean; className?: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Size the canvas UNCONDITIONALLY (backing store + CSS) before touching the 2d
    // context, so a no-canvas environment (jsdom → getContext returns null) still gets
    // a correctly-sized element and only skips the drawing.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(size * dpr);
    canvas.style.width = canvas.style.height = `${size}px`;
    const g = canvas.getContext("2d");
    if (!g) return; // jsdom / no 2d support — sized but not drawn; never throw
    const R = size / 2;
    const ph = ((size * 97) % 628) / 100; // deterministic phase from size (no Math.random)

    const draw = (t: number) => {
      const P = orbPalette();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath(); g.arc(R, R, R - 0.5, 0, 6.2832); g.clip();
      const base = g.createRadialGradient(R * 0.72, R * 0.62, R * 0.12, R, R, R);
      base.addColorStop(0, P.base1); base.addColorStop(1, P.base2);
      g.fillStyle = base; g.fillRect(0, 0, size, size);
      P.ribbons.forEach((rb, i) => {
        const white = rb[0] === "#FFFFFF";
        g.globalCompositeOperation = P.additive || white ? "lighter" : "source-over";
        const rot = ph + i * 1.3 + (animate ? t * 0.00022 * (i % 2 ? 1 : -1) * (1 + i * 0.25) : i * 0.7);
        const squish = 0.32 + 0.1 * Math.sin(ph + i + (animate ? t * 0.0006 : 0));
        g.save();
        g.translate(R + Math.sin(rot * 1.4 + i) * R * 0.08, R + Math.cos(rot + i) * R * 0.08);
        g.rotate(rot);
        g.beginPath(); g.ellipse(0, 0, R * 0.62, R * squish, 0, 0, 6.2832);
        g.filter = `blur(${size * 0.055}px)`;
        g.strokeStyle = rb[0]; g.globalAlpha = rb[1] * 0.55; g.lineWidth = size * 0.085; g.stroke();
        g.filter = `blur(${size * 0.014}px)`;
        g.globalAlpha = rb[1]; g.lineWidth = size * 0.02; g.stroke();
        g.restore();
      });
      g.filter = "none"; g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      const glow = g.createRadialGradient(R, R * 1.5, 0, R, R * 1.5, R);
      glow.addColorStop(0, P.under); glow.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = glow; g.fillRect(0, 0, size, size);
      g.restore();
      g.beginPath(); g.arc(R, R, R - 1, 0, 6.2832); g.strokeStyle = P.rim; g.lineWidth = 1.1; g.stroke();
      g.beginPath(); g.arc(R, R, R - 1.6, Math.PI * 1.05, Math.PI * 1.75); g.strokeStyle = P.arc; g.lineWidth = 1.5; g.stroke();
      const spec = g.createRadialGradient(R * 0.62, R * 0.5, 0, R * 0.62, R * 0.5, R * 0.45);
      spec.addColorStop(0, P.spec); spec.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = spec; g.beginPath(); g.ellipse(R * 0.62, R * 0.48, R * 0.34, R * 0.22, -0.5, 0, 6.2832); g.fill();
    };

    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    if (animate && !reduce) {
      const loop = (t: number) => { if (!document.hidden) draw(t); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    } else {
      draw(0);
    }

    // Repaint on theme flip (static orbs especially).
    const repaint = () => draw(0);
    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener?.("change", repaint);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      mo.disconnect();
      mq?.removeEventListener?.("change", repaint);
    };
  }, [size, animate]);

  return (
    <span aria-hidden="true" className={"grid place-items-center rounded-full " + (className ?? "")}>
      <canvas ref={ref} className="block rounded-full" />
    </span>
  );
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm test:unit -- --no-file-parallelism tests/unit/assistant-orb.test.tsx`
Expected: PASS.

---

## Task 6: `SuggestionChips.tsx`

**Files:**
- Create: `src/components/assistant/SuggestionChips.tsx`
- Test: `tests/unit/assistant-suggestions.test.tsx`

**Interfaces:**
- Produces: `export function SuggestionChips(props: { items: string[]; onSelect: (q: string) => void; disabled?: boolean }): JSX.Element`. Consumed by Task 8.

Match the mockup `.sugg`/`.chips`/`.chip` (lines 181–190): an uppercase label "Suggested · changes with the screen you're on", then a wrapped row of pill buttons. Chip DSN-03: hover → `border-brand-strong text-brand-ink bg-brand-soft shadow-md -translate-y-px`; active → `translate-y-0 shadow-sm`; disabled → `opacity-45`. Wrap in `role="group" aria-label="Suggested questions"`.

- [ ] **Step 1: Write the failing test** — `tests/unit/assistant-suggestions.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestionChips } from "@/components/assistant/SuggestionChips";

describe("WP-AI-2 SuggestionChips", () => {
  it("renders one button per item under a labelled group", () => {
    render(<SuggestionChips items={["How are my partners performing?", "Which states have no coverage?"]} onSelect={() => {}} />);
    expect(screen.getByRole("group", { name: /suggested questions/i })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
  it("DSN-03: calls onSelect with the question text on click", async () => {
    const onSelect = vi.fn();
    render(<SuggestionChips items={["Explain this screen"]} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Explain this screen" }));
    expect(onSelect).toHaveBeenCalledWith("Explain this screen");
  });
  it("DSN-03: disables every chip when disabled", () => {
    render(<SuggestionChips items={["A", "B"]} onSelect={() => {}} disabled />);
    for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `pnpm test:unit -- --no-file-parallelism tests/unit/assistant-suggestions.test.tsx` → FAIL.

- [ ] **Step 3: Implement `src/components/assistant/SuggestionChips.tsx`:**

```tsx
"use client";

import * as React from "react";

export function SuggestionChips({ items, onSelect, disabled }: { items: string[]; onSelect: (q: string) => void; disabled?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="ml-8 self-stretch">
      <div className="mb-1.5 text-step-0 font-semibold uppercase tracking-[.08em] text-text-3">
        Suggested · changes with the screen you&rsquo;re on
      </div>
      <div role="group" aria-label="Suggested questions" className="flex flex-wrap gap-1.5">
        {items.map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(q)}
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-step-1 text-text-2 shadow-xs transition-all duration-150 hover:-translate-y-px hover:border-brand-strong hover:bg-brand-soft hover:text-brand-ink hover:shadow-md focus-visible:border-brand-strong active:translate-y-0 active:shadow-sm disabled:pointer-events-none disabled:opacity-45"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it green** — `pnpm test:unit -- --no-file-parallelism tests/unit/assistant-suggestions.test.tsx` → PASS.

---

## Task 7: `AnswerBody.tsx` + `AssistantMessage.tsx`

**Files:**
- Create: `src/components/assistant/AnswerBody.tsx`
- Create: `src/components/assistant/AssistantMessage.tsx`
- Test: `tests/unit/assistant-message.test.tsx`

**Interfaces:**
- `AnswerBody`: `export function AnswerBody({ text }: { text: string }): JSX.Element` — renders `formatAnswer(text)` blocks (paragraphs + dash-marker bullet lists; bold spans `font-semibold`; ref spans `.num text-brand-ink`).
- `AssistantMessage`: `export function AssistantMessage(props: AssistantMessageProps): JSX.Element` where:

```ts
export interface AssistantSource { label: string; path?: string }
export interface AssistantMessageProps {
  id: string;                    // UI message id (feedback key)
  text: string;                  // concatenated text parts
  sources: AssistantSource[];    // from tool-part outputs (deduped upstream)
  showThumbs?: boolean;          // false for the welcome message
  onFeedback?: (id: string, rating: "up" | "down") => void;
}
```
- Consumed by Task 8 (transcript) + Task 11 (gallery fixtures).

Behavior:
- Avatar = `<Orb size={24} />` at the row start (mockup `.bot-row .avatar`).
- Deep link: pick the FIRST source with a `path` where `isInternalPath(path)` is true; render one `.deeplink` pill (`{label} →`). If none, no link. (PRN-10.)
- Source chips: render each source's `label` as a `.src` pill (dot + label), deduped by label.
- Thumbs (when `showThumbs`): up/down buttons (`aria-pressed`), calling `onFeedback(id, rating)`; after a click show "Thanks — feedback recorded." and lock the pair to the pressed one.

- [ ] **Step 1: Write the failing test** — `tests/unit/assistant-message.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantMessage } from "@/components/assistant/AssistantMessage";

describe("WP-AI-2 AssistantMessage", () => {
  it("AIA-03: renders bullets and mono ref spans from the answer text", () => {
    render(<AssistantMessage id="m1" text={"Top partner:\n- JV-003 got 88 leads"} sources={[]} />);
    expect(screen.getByText("JV-003")).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
  });
  it("PRN-10: renders a deep link only for an internal path", () => {
    render(<AssistantMessage id="m2" text="ok" sources={[{ label: "Coverage map", path: "/coverage" }]} />);
    const link = screen.getByRole("link", { name: /coverage map/i });
    expect(link.getAttribute("href")).toBe("/coverage");
  });
  it("PRN-10: never renders a link for a non-internal path", () => {
    render(<AssistantMessage id="m3" text="ok" sources={[{ label: "Evil", path: "https://evil.example/x" }]} />);
    expect(screen.queryByRole("link")).toBeNull();
    // but the source label still shows as a plain chip
    expect(screen.getByText("Evil")).toBeTruthy();
  });
  it("AIA-04/DSN-03: thumbs fire onFeedback and confirm", async () => {
    const onFeedback = vi.fn();
    render(<AssistantMessage id="m4" text="ok" sources={[]} showThumbs onFeedback={onFeedback} />);
    await userEvent.click(screen.getByRole("button", { name: /helpful/i }));
    expect(onFeedback).toHaveBeenCalledWith("m4", "up");
    expect(screen.getByText(/feedback recorded/i)).toBeTruthy();
  });
  it("omits thumbs for the welcome message", () => {
    render(<AssistantMessage id="w" text="Hi" sources={[]} showThumbs={false} />);
    expect(screen.queryByRole("button", { name: /helpful/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `pnpm test:unit -- --no-file-parallelism tests/unit/assistant-message.test.tsx` → FAIL.

- [ ] **Step 3a: Implement `src/components/assistant/AnswerBody.tsx`:**

```tsx
"use client";

import * as React from "react";
import { formatAnswer, type InlineSpan } from "@/modules/ai/format-answer";

function Spans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.kind === "bold" ? <strong key={i} className="font-semibold">{s.text}</strong>
        : s.kind === "ref" ? <span key={i} className="num text-brand-ink">{s.text}</span>
        : <React.Fragment key={i}>{s.text}</React.Fragment>,
      )}
    </>
  );
}

export function AnswerBody({ text }: { text: string }) {
  const blocks = formatAnswer(text);
  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((b, i) =>
        b.type === "p" ? (
          <p key={i}><Spans spans={b.spans} /></p>
        ) : (
          <ul key={i} className="flex flex-col gap-1">
            {b.items.map((item, j) => (
              <li key={j} className="relative pl-4 before:absolute before:left-0 before:font-semibold before:text-brand-ink before:content-['–']">
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 3b: Implement `src/components/assistant/AssistantMessage.tsx`:**

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { isInternalPath } from "@/modules/ai/prompt";
import { Orb } from "./Orb";
import { AnswerBody } from "./AnswerBody";

export interface AssistantSource { label: string; path?: string }
export interface AssistantMessageProps {
  id: string;
  text: string;
  sources: AssistantSource[];
  showThumbs?: boolean;
  onFeedback?: (id: string, rating: "up" | "down") => void;
}

function ThumbIcon({ down }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" style={down ? { transform: "rotate(180deg)" } : undefined} aria-hidden="true">
      <path d="M7 11v9h10a3 3 0 0 0 3-3l-1-6a2 2 0 0 0-2-2h-4l1-4a2 2 0 0 0-2-2l-5 8H4v9h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AssistantMessage({ id, text, sources, showThumbs = true, onFeedback }: AssistantMessageProps) {
  const [rated, setRated] = React.useState<"up" | "down" | null>(null);

  // Dedupe source labels; the deep link is the first source with an internal path (PRN-10).
  const seen = new Set<string>();
  const chips = sources.filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)));
  const link = sources.find((s) => s.path && isInternalPath(s.path));

  const rate = (r: "up" | "down") => { setRated(r); onFeedback?.(id, r); };

  return (
    <div className="flex max-w-[94%] items-start gap-2">
      <Orb size={24} className="mt-0.5 shrink-0" />
      <div className="flex-1 rounded-[15px] rounded-tl-[5px] border border-border-soft bg-surface p-2.5 px-3 text-step-2 leading-relaxed shadow-xs">
        <AnswerBody text={text} />
        {(chips.length > 0 || link || showThumbs) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {chips.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-2 px-2.5 py-0.5 text-step-0 text-text-3">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-[2px] bg-info" />
                {s.label}
              </span>
            ))}
            {link && (
              <Link href={link.path!} className="inline-flex items-center gap-1 rounded-full border border-brand-line bg-brand-soft px-2.5 py-0.5 text-step-1 font-semibold text-brand-ink no-underline transition-all duration-150 hover:border-brand-strong hover:shadow-xs">
                {link.label} →
              </Link>
            )}
            {showThumbs && (
              <span role="group" aria-label="Was this helpful?" className="ml-auto inline-flex gap-0.5">
                <button type="button" aria-label="Helpful" aria-pressed={rated === "up"} disabled={rated !== null} onClick={() => rate("up")} className="grid h-6.5 w-6.5 place-items-center rounded-md border border-transparent text-text-3 hover:border-border hover:bg-surface-2 focus-visible:border-border aria-pressed:border-brand-line aria-pressed:bg-brand-soft aria-pressed:text-brand-ink disabled:opacity-100">
                  <ThumbIcon />
                </button>
                <button type="button" aria-label="Not helpful" aria-pressed={rated === "down"} disabled={rated !== null} onClick={() => rate("down")} className="grid h-6.5 w-6.5 place-items-center rounded-md border border-transparent text-text-3 hover:border-border hover:bg-surface-2 focus-visible:border-border aria-pressed:border-brand-line aria-pressed:bg-brand-soft aria-pressed:text-brand-ink disabled:opacity-100">
                  <ThumbIcon down />
                </button>
              </span>
            )}
          </div>
        )}
        {rated && <div className="mt-1.5 text-step-0 text-success">Thanks — feedback recorded.</div>}
      </div>
    </div>
  );
}
```

Note: `h-6.5`/`w-6.5` are not default Tailwind — use `h-[26px] w-[26px]` instead (26px per mockup). Fix during implementation. Similarly confirm `aria-pressed:` variant is available in this Tailwind v4 config; if not, compute the pressed classes with a ternary.

- [ ] **Step 4: Run it green** — `pnpm test:unit -- --no-file-parallelism tests/unit/assistant-message.test.tsx` → PASS. Then `pnpm typecheck`.

---

## Task 8: `AssistantWidget.tsx` — orchestrator (launcher + panel + useChat)

**Files:**
- Create: `src/components/assistant/AssistantWidget.tsx`
- Test: `tests/unit/assistant-widget.test.tsx`

**Interfaces:**
- Produces: `export default function AssistantWidget(): JSX.Element`. Consumed by Task 9 (AppShell lazy import).
- Consumes: `Orb`, `SuggestionChips`, `AssistantMessage`, `screenForPath`, `suggestionsFor`, `gateStateFromCode`, `csrfHeaders`, `useChat`, `DefaultChatTransport`, `isToolUIPart`, `getToolName`.

Design (port mockup lines 117–219 + 257–289 to Tailwind):
- **State:** `open` (bool), `input` (string draft), `gate` (`AssistantGate | null`). `usePathname()` → `screen = screenForPath(path)`.
- **useChat:** transport = `new DefaultChatTransport({ api: "/api/ai/chat", fetch: gateFetch, prepareSendMessagesRequest: ({ messages }) => ({ body: { messages, screen }, headers: csrfHeaders() }) })`. `gateFetch` wraps `fetch`, and on `!res.ok` reads `res.clone().json()` → `gateStateFromCode(body?.code)`; if non-null, `setGate(state)`; returns `res`.
- **Sending:** `sendMessage({ text })` from the input or a chip; clear the draft; ignore when `gate` set or `status !== "ready"`.
- **Transcript:** render each message: `role === "user"` → the user bubble; `role === "assistant"` → gather text from `part.type === "text"` parts and sources from tool parts (`isToolUIPart(part) && part.state === "output-available"` → `part.output` as `{ source?: string; path?: string }` → `{ label: output.source, path: output.path }`), then `<AssistantMessage id={m.id} text={text} sources={sources} onFeedback={sendFeedback} />`. Show a typing indicator while `status === "submitted" || status === "streaming"` and the last message is the user's.
- **Welcome + chips:** when there are no messages, show the welcome `AssistantMessage` (`showThumbs={false}`) + `<SuggestionChips items={suggestionsFor(screen)} onSelect={send} disabled={!!gate} />`.
- **Cap band:** when `gate === "budget"` show the allowance band (mockup `.capband`, warn-soft, NO $); when `"rate"` show a "too many questions, try again in a minute" band; when `"disabled"` show an "assistant is switched off — enable it in Settings → AI assistant" band linking to `/settings/ai`. Disable the input + send + chips whenever `gate` is set.
- **Feedback:** `sendFeedback(id, rating)` = `apiMutate("/api/ai/feedback", "POST", { messageId: id, rating })` (fire-and-forget; swallow errors — the UI already showed "Thanks").
- **Scroll-aware header shadow:** ref on the scroll container; on scroll toggle a `scrolled` flag → header gets `shadow-md`.
- **Launcher:** `<button class="… assistant-breathe">` containing `<Orb size={52} animate />`; `aria-label` "Open assistant"/"Close assistant"; `aria-expanded={open}`; toggles `open`.
- **Panel open/close transition:** opacity + translate; `pointer-events-none` when closed. Respect reduced-motion (transition still fine; the global reduce rule zeroes it).
- Autofocus the input when the panel opens; Escape closes the panel.

- [ ] **Step 1: Write the failing test** — `tests/unit/assistant-widget.test.tsx`. Mock `@ai-sdk/react` so no network is needed:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ usePathname: () => "/coverage" }));
const sendMessage = vi.fn();
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({ messages: [], status: "ready", error: undefined, sendMessage, setMessages: vi.fn(), clearError: vi.fn(), stop: vi.fn() }),
  DefaultChatTransport: class { constructor(_: unknown) {} },
}));

import AssistantWidget from "@/components/assistant/AssistantWidget";

describe("WP-AI-2 AssistantWidget", () => {
  beforeEach(() => sendMessage.mockClear());

  it("renders the launcher collapsed by default", () => {
    render(<AssistantWidget />);
    expect(screen.getByRole("button", { name: /open assistant/i })).toBeTruthy();
  });

  it("opens the panel and shows the welcome + contextual chips for the current screen", async () => {
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
    expect(screen.getByRole("group", { name: /suggested questions/i })).toBeTruthy();
    // /coverage screen → coverage suggestions (from suggestionsFor)
    expect(screen.getByRole("button", { name: /which states have no coverage/i })).toBeTruthy();
  });

  it("sends a chip's question via sendMessage", async () => {
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
    await userEvent.click(screen.getByRole("button", { name: /which states have no coverage/i }));
    expect(sendMessage).toHaveBeenCalledWith({ text: "Which states have no coverage?" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `pnpm test:unit -- --no-file-parallelism tests/unit/assistant-widget.test.tsx` → FAIL.

- [ ] **Step 3: Implement `src/components/assistant/AssistantWidget.tsx`.** Skeleton with the real wiring (fill styling from the mockup; use tokens throughout):

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { csrfHeaders } from "@/lib/csrf-client";
import { apiMutate } from "@/lib/api";
import { suggestionsFor } from "@/modules/ai/suggestions";
import { screenForPath } from "@/modules/ai/screen";
import { gateStateFromCode, type AssistantGate } from "@/modules/ai/gate-error";
import { Orb } from "./Orb";
import { SuggestionChips } from "./SuggestionChips";
import { AssistantMessage, type AssistantSource } from "./AssistantMessage";

const WELCOME = "Hi — I can answer questions about your workspace: partners, leads, coverage, imports, or what a screen does.";

export default function AssistantWidget() {
  const path = usePathname() ?? "";
  const screen = screenForPath(path);
  const screenRef = React.useRef(screen);
  screenRef.current = screen; // read the latest screen inside the transport closure

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [gate, setGate] = React.useState<AssistantGate | null>(null);
  const [scrolled, setScrolled] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const gateFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    if (!res.ok) {
      const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
      const g = gateStateFromCode(body?.code);
      if (g) setGate(g);
    }
    return res;
  };

  const { messages, status, sendMessage } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      fetch: gateFetch,
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { messages, screen: screenRef.current },
        headers: csrfHeaders(),
      }),
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  const blocked = gate !== null;

  const send = (text: string) => {
    const t = text.trim();
    if (!t || blocked || busy) return;
    setDraft("");
    void sendMessage({ text: t });
  };

  const sendFeedback = (id: string, rating: "up" | "down") => {
    void apiMutate("/api/ai/feedback", "POST", { messageId: id, rating }).catch(() => {});
  };

  // autofocus on open; Escape closes.
  React.useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // keep the transcript pinned to the newest message.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const textOf = (m: UIMessage) =>
    m.parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("");
  const sourcesOf = (m: UIMessage): AssistantSource[] =>
    m.parts.flatMap((p) => {
      if (!isToolUIPart(p) || p.state !== "output-available") return [];
      const out = p.output as { source?: string; path?: string } | undefined;
      return out?.source ? [{ label: out.source, path: out.path }] : [];
    });

  return (
    <>
      {/* Panel */}
      <section
        aria-label="Assistant"
        className={
          "fixed bottom-[92px] right-6 z-50 flex h-[min(640px,calc(100vh-128px))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-[18px] border border-border bg-surface shadow-lg transition-all duration-200 max-[520px]:inset-x-2 max-[520px]:bottom-[88px] max-[520px]:h-[calc(100vh-104px)] max-[520px]:w-auto " +
          (open ? "opacity-100" : "pointer-events-none translate-y-3 scale-95 opacity-0")
        }
      >
        {/* Header */}
        <header className={"relative z-[2] flex flex-none items-center gap-3 border-b border-border-soft bg-[linear-gradient(180deg,var(--brand-soft),var(--surface)_130%)] px-4 py-3.5 transition-shadow " + (scrolled ? "shadow-md" : "")}>
          <Orb size={34} animate className="shrink-0" />
          <div className="min-w-0">
            <div className="font-display text-step-3 leading-tight">Assistant</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-step-0 text-text-3">
              <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-success" />
              Answers from your workspace · chats aren&rsquo;t saved
            </div>
          </div>
          <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)} className="ml-auto grid h-[34px] w-[34px] flex-none place-items-center rounded-lg border border-transparent text-text-3 hover:border-border hover:bg-surface focus-visible:border-border">
            ✕
          </button>
        </header>

        {/* Transcript */}
        <div ref={scrollRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)} aria-live="polite" className="flex flex-1 flex-col gap-3 overflow-y-auto bg-bg px-3.5 pb-3 pt-4">
          {messages.length === 0 && (
            <>
              <AssistantMessage id="welcome" text={WELCOME} sources={[]} showThumbs={false} />
              <SuggestionChips items={suggestionsFor(screen)} onSelect={send} disabled={blocked} />
            </>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="max-w-[90%] self-end rounded-[15px] rounded-br-[5px] border border-brand-line bg-brand-soft px-3 py-2.5 text-step-2 leading-relaxed text-text">
                {textOf(m)}
              </div>
            ) : (
              <AssistantMessage key={m.id} id={m.id} text={textOf(m)} sources={sourcesOf(m)} onFeedback={sendFeedback} />
            ),
          )}
          {busy && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2">
              <Orb size={24} className="shrink-0" />
              <div className="flex gap-1 rounded-[15px] rounded-tl-[5px] border border-border-soft bg-surface px-3.5 py-3" aria-label="Assistant is thinking">
                <i className="h-1.5 w-1.5 animate-[blink_1s_infinite] rounded-full bg-text-3" />
                <i className="h-1.5 w-1.5 animate-[blink_1s_infinite_.18s] rounded-full bg-text-3" />
                <i className="h-1.5 w-1.5 animate-[blink_1s_infinite_.36s] rounded-full bg-text-3" />
              </div>
            </div>
          )}
        </div>

        {/* Cap / rate / disabled band */}
        {blocked && (
          <div className="flex flex-none items-start gap-2.5 border-t border-border-soft bg-warn-soft px-3.5 py-2.5 text-step-1 text-text-2">
            <span aria-hidden="true" className="grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] bg-warn text-step-0 font-bold text-on-status">!</span>
            <span>
              {gate === "budget" && <>You&rsquo;ve used this month&rsquo;s AI allowance. Raise the limit in <Link href="/settings/ai" className="font-semibold text-brand-ink">Settings → AI assistant</Link>.</>}
              {gate === "rate" && <>That&rsquo;s a lot of questions at once — give it a minute and try again.</>}
              {gate === "disabled" && <>The assistant is switched off. Turn it on in <Link href="/settings/ai" className="font-semibold text-brand-ink">Settings → AI assistant</Link>.</>}
            </span>
          </div>
        )}

        {/* Composer */}
        <footer className="relative z-[2] flex-none border-t border-border-soft bg-surface px-3.5 py-3 shadow-up">
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-bg py-1 pl-4 pr-1 transition-colors focus-within:border-brand-ink">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              disabled={blocked}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(draft); }}
              placeholder="Ask about leads, partners, coverage…"
              aria-label="Ask the assistant"
              className="flex-1 border-none bg-transparent py-1.5 text-step-2 text-text outline-none placeholder:text-text-3 disabled:opacity-50"
            />
            <button type="button" aria-label="Send" disabled={blocked || busy || draft.trim() === ""} onClick={() => send(draft)} className="grid h-9 w-9 flex-none place-items-center rounded-full border border-brand-strong bg-brand text-brand-contrast shadow-xs transition-all hover:bg-brand-strong hover:shadow-md active:scale-95 disabled:opacity-45 disabled:shadow-none">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </footer>
      </section>

      {/* Launcher */}
      <button
        type="button"
        aria-label={open ? "Close assistant" : "Open assistant"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="assistant-breathe fixed bottom-6 right-6 z-40 grid h-[58px] w-[58px] place-items-center rounded-full border-none bg-transparent p-0 transition-transform duration-150 hover:scale-[1.06] active:scale-95"
      >
        <Orb size={52} animate />
      </button>
    </>
  );
}
```

- [ ] **Step 3b: Add the `blink` keyframe** to `globals.css` (used by the typing dots) after `assistant-breathe`:

```css
@keyframes blink { 0%, 70%, 100% { opacity: 0.25; } 35% { opacity: 1; } }
```

- [ ] **Step 4: Run it green** — `pnpm test:unit -- --no-file-parallelism tests/unit/assistant-widget.test.tsx` then `pnpm typecheck`. Expected: PASS + clean. Resolve any `UIMessage` part-type narrowing with the `isToolUIPart`/`getToolName` helpers from `ai`.

---

## Task 9: Mount the widget in `AppShell`

**Files:**
- Modify: `src/components/AppShell.tsx` (add the lazy import near the top; render after `<main>`)
- Test: `tests/unit/appshell-assistant.test.tsx`

**Interfaces:**
- Consumes: `AssistantWidget` (default export). Lazy via `next/dynamic` with `ssr: false` so the AI/react-chat code stays out of the SSR + base bundle.

- [ ] **Step 1: Write the failing test** — `tests/unit/appshell-assistant.test.tsx`. `next/dynamic(..., {ssr:false})` renders nothing on first paint, so assert the import wiring by mocking dynamic to render its module:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("@tanstack/react-query", async (orig) => {
  const mod = await orig<typeof import("@tanstack/react-query")>();
  return { ...mod, useQuery: () => ({ data: undefined }) };
});
// Render the lazily-imported widget synchronously in the test.
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: React.ComponentType }>) => {
  return function Stub() { return <div data-testid="assistant-mounted" />; };
} }));

import { AppShell } from "@/components/AppShell";

describe("WP-AI-2: AppShell mounts the assistant on the admin surface", () => {
  it("renders the lazily-mounted assistant widget", () => {
    render(<AppShell><div>page</div></AppShell>);
    expect(screen.getByTestId("assistant-mounted")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — FAIL (no widget mounted yet).

- [ ] **Step 3: Wire it into `AppShell.tsx`.** Add near the imports:

```tsx
import dynamic from "next/dynamic";

// Admin-only, lazy: the AI SDK + chat UI stay out of the base bundle and never SSR.
const AssistantWidget = dynamic(() => import("./assistant/AssistantWidget"), { ssr: false });
```

Then render it just after `<main …>{children}</main>` (inside the `<div className="flex min-w-0 flex-col" …>` wrapper, or immediately after it — it is `position: fixed`, so placement is not visually load-bearing):

```tsx
        <main className="anim-fade w-full max-w-[1240px] px-6 pb-14 pt-5 md:px-8">{children}</main>
        <AssistantWidget />
```

- [ ] **Step 4: Run it green** — `pnpm test:unit -- --no-file-parallelism tests/unit/appshell-assistant.test.tsx` then re-run the existing AppShell nav test to confirm no regression. Expected: PASS.

---

## Task 10: `Settings → AI assistant` section

**Files:**
- Modify: `src/app/settings/settings-nav.tsx` (add the nav item)
- Create: `src/app/settings/ai/page.tsx`
- Create: `src/app/settings/ai/ai-settings.tsx`
- Test: `tests/unit/settings-ai.test.tsx`

**Interfaces:**
- `GET /api/settings/ai` → `{ settings: { enabled: boolean; capUsd: number }, usage: { spentMicroUsd: number; spentUsd: number } }`.
- `PUT /api/settings/ai` body `{ enabled: boolean; capUsd: number }` → `{ settings }` (via `apiMutate`).

- [ ] **Step 1: Add the nav item.** In `src/app/settings/settings-nav.tsx`, add to the `Organization` group's `items` (after Billing):

```tsx
    { href: "/settings/ai", label: "AI assistant" },
```

- [ ] **Step 2: Write the failing test** — `tests/unit/settings-ai.test.tsx`. Wrap in a real `QueryClientProvider`; mock the API helpers:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiGet = vi.fn();
const apiMutate = vi.fn();
vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a), apiMutate: (...a: unknown[]) => apiMutate(...a), ApiError: class {} }));

import { AiSettings } from "@/app/settings/ai/ai-settings";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("WP-AI-2 AiSettings", () => {
  beforeEach(() => { apiGet.mockReset(); apiMutate.mockReset(); });

  it("SET-11: shows the enable switch, cap and month-to-date usage in $", async () => {
    apiGet.mockResolvedValue({ settings: { enabled: true, capUsd: 10 }, usage: { spentMicroUsd: 3_450_000, spentUsd: 0.35 } });
    wrap(<AiSettings />);
    expect(await screen.findByText(/\$0\.35/)).toBeTruthy();
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("BIL-04: saving PUTs the enabled + cap values", async () => {
    apiGet.mockResolvedValue({ settings: { enabled: false, capUsd: 10 }, usage: { spentMicroUsd: 0, spentUsd: 0 } });
    apiMutate.mockResolvedValue({ settings: { enabled: true, capUsd: 25 } });
    wrap(<AiSettings />);
    await screen.findByRole("switch");
    await userEvent.click(screen.getByRole("switch"));
    const cap = screen.getByLabelText(/monthly allowance/i);
    await userEvent.clear(cap);
    await userEvent.type(cap, "25");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/settings/ai", "PUT", { enabled: true, capUsd: 25 }));
  });
});
```

- [ ] **Step 3: Implement `src/app/settings/ai/ai-settings.tsx`** (client). Use `Switch` + `Input` + `Button` + `useToast` from the barrel; TanStack Query for load; local draft seeded from server via the adjust-during-render pattern (NOT setState-in-effect — see the lint gotcha in memory):

```tsx
"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { Card, CardBody, Switch, Input, Button, Stat, EmptyState, Skeleton, useToast } from "@/components";

interface AiSettingsPayload { settings: { enabled: boolean; capUsd: number }; usage: { spentMicroUsd: number; spentUsd: number } }

export function AiSettings() {
  const qc = useQueryClient();
  const { toast } = useToast(); // useToast() returns { toast(message, tone?) }
  const q = useQuery({ queryKey: ["settings", "ai"], queryFn: () => apiGet<AiSettingsPayload>("/api/settings/ai") });

  // Seed the editable draft from server data WITHOUT setState-in-effect (react-hooks/set-state-in-effect):
  const [seed, setSeed] = React.useState<AiSettingsPayload["settings"] | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [cap, setCap] = React.useState("10");
  if (q.data && q.data.settings !== seed) {
    setSeed(q.data.settings);
    setEnabled(q.data.settings.enabled);
    setCap(String(q.data.settings.capUsd));
  }

  const save = useMutation({
    mutationFn: () => apiMutate("/api/settings/ai", "PUT", { enabled, capUsd: Number(cap) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings", "ai"] }); toast("AI settings saved.", "success"); },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) return <EmptyState title="Couldn’t load AI settings" description="Refresh to try again." />;

  const capNum = Number(cap);
  const capValid = Number.isFinite(capNum) && capNum > 0 && capNum <= 1000;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-text">Assistant enabled</span>
              <span className="block text-step-1 text-text-2">Show the in-app assistant to admins in this workspace.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} ariaLabel="Assistant enabled" />
          </label>

          <Input
            label="Monthly allowance (USD)"
            type="number"
            min={1}
            max={1000}
            step={1}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            hint="The assistant stops answering for the rest of the month once this is reached."
            className="max-w-[160px]"
          />

          <Stat label="Used this month" value={`$${q.data.usage.spentUsd.toFixed(2)}`} />

          <div>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!capValid}>Save changes</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
```

Signatures verified against `src/components/`: `Switch { checked, onCheckedChange, label?, ariaLabel? }` · `Input` extends native input attrs + built-in `label`/`hint` · `Stat { label, value, foot? }` · `Button { variant, size, loading, leftIcon }` · `useToast() → { toast(message, tone?) }`. The `Input` built-in label makes `getByLabelText(/monthly allowance/i)` resolve.

- [ ] **Step 4: Implement `src/app/settings/ai/page.tsx`** (server wrapper):

```tsx
import { SettingsSection } from "../settings-section";
import { AiSettings } from "./ai-settings";

export default function AiSettingsPage() {
  return (
    <SettingsSection title="AI assistant" description="The in-app assistant, its monthly allowance, and usage this month.">
      <AiSettings />
    </SettingsSection>
  );
}
```

- [ ] **Step 5: Run it green** — `pnpm test:unit -- --no-file-parallelism tests/unit/settings-ai.test.tsx` then `pnpm typecheck`. Expected: PASS + clean. Verify `/settings/ai` is already covered by the `/settings` proxy protection (it is — prefix match; no proxy change).

---

## Task 11: Verification — gallery fixtures, screenshots, live smoke, owner walkthrough

**Files:**
- Create (throwaway, DELETE before commit): `src/app/gallery/assistant/page.tsx`

- [ ] **Step 1: Build a throwaway preview route** rendering the PRESENTATIONAL pieces with fixtures (no auth, no API) so every state screenshots deterministically. Compose `AssistantMessage` (welcome; a perf answer with sources + `/partners/...` deep link + thumbs; a coverage refusal), `SuggestionChips`, an open panel shell, the cap band, and the launcher — for both themes via `?t=light|dark` setting `data-theme` on `<html>`. Example:

```tsx
"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AssistantMessage } from "@/components/assistant/AssistantMessage";
import { SuggestionChips } from "@/components/assistant/SuggestionChips";
import { Orb } from "@/components/assistant/Orb";
import { suggestionsFor } from "@/modules/ai/suggestions";

export default function GalleryAssistant() {
  const t = useSearchParams().get("t");
  React.useEffect(() => { if (t) document.documentElement.setAttribute("data-theme", t); }, [t]);
  return (
    <div className="min-h-screen bg-bg p-6">
      <div className="mx-auto flex w-[400px] flex-col gap-3 rounded-[18px] border border-border bg-surface p-4 shadow-lg">
        <AssistantMessage id="w" text="Hi — I can answer questions about your workspace: partners, leads, coverage, imports, or what a screen does." sources={[]} showThumbs={false} />
        <SuggestionChips items={suggestionsFor("dashboard")} onSelect={() => {}} />
        <AssistantMessage id="a1" text={"**Meridian Buyers** JV-003 is your top partner this month:\n- 88 leads received — the most of any partner\n- 61 contacted (69%)\n- 5 closed"} sources={[{ label: "Partner performance · 30d", path: "/partners/abc" }]} onFeedback={() => {}} />
        <AssistantMessage id="a2" text="I don’t have that — I can only see the ranges available in the app (7, 30 days, 12 months, all time). The Imports page lists every processed week." sources={[{ label: "Imports", path: "/imports" }]} onFeedback={() => {}} />
      </div>
      <div className="mt-6"><Orb size={58} animate /></div>
    </div>
  );
}
```

- [ ] **Step 2: Serve + screenshot both themes with Playwright MCP.** Build/start on a free port (Next 16 one-`next dev` per dir — another chat may hold :3000): `pnpm build && pnpm exec next start -p 4320` (or `next dev` if free). Navigate Playwright to `http://localhost:4320/gallery/assistant?t=light` and `?t=dark`; screenshot. Verify: orb renders in both themes; bullets + mono refs; source chip + deep link pill; thumbs; refusal answer. (In-app Browser screenshot tool flakes → use Playwright MCP; if `navigate` drops the path, `window.location.assign('.../gallery/assistant?t=dark')` via evaluate.)

- [ ] **Step 3: Live end-to-end smoke (real streamed answer).** `.env.local` has `AI_PROVIDER=google` + `GOOGLE_GENERATIVE_AI_API_KEY` (dev synthetic data). Log into the running app as `dev-admin@dev-jv.test` / `Dev-Admin-Pass-2026!x` via Playwright, first enable the assistant at `/settings/ai` (Switch on, Save), then open the launcher on `/dashboard`, ask "How are my partners performing?", and confirm a real streamed bulleted answer with source chips + a working deep link. Screenshot it. Also verify the cap band by temporarily setting the cap to a tiny value if practical (optional).

- [ ] **Step 4: Owner walkthrough.** Present the light+dark screenshots + the live answer screenshot. Get design sign-off. Iterate on styling against the mockup if requested.

- [ ] **Step 5: DELETE the throwaway route** `src/app/gallery/assistant/` before the commit. Confirm nothing else imports it.

---

## Task 12: Self-audit + audit agents

- [ ] **Step 1: Run the PLAYBOOK §6 self-audit** and fill the checklist (print it in the summary). Confirm: PRN-12 (grep the new components for hex/`#`/hardcoded fonts — expect only the Orb canvas palette, which is documented canvas paint, not DOM styling), PRN-10 (deep-link whitelist), PRN-14 (chips carry labels; live dot decorative), DSN-03 (all interactive elements have the five states), widget-has-no-$ (grep the assistant dir for `$`/`spentUsd` → none), server-data-via-Query (no server data copied into state).

- [ ] **Step 2: Typecheck + lint + full unit suite.**

Run: `pnpm typecheck`
Run: `pnpm lint` on the CHANGED files only (memory: repo-wide lint has stale-worktree noise). E.g. `pnpm exec eslint src/components/assistant src/modules/ai/screen.ts src/modules/ai/format-answer.ts src/modules/ai/gate-error.ts src/app/settings/ai`
Run: `pnpm test:unit -- --no-file-parallelism`
Expected: all green.

- [ ] **Step 3: Dispatch the mandatory review agents** (parallel, read-only): `pr-reviewer` (always) + `audit-design-system` + `audit-a11y` + `audit-frontend-arch` (MANDATORY for this UI per the design doc §10). Give each the diff scope (`src/components/assistant/**`, `src/modules/ai/{screen,format-answer,gate-error}.ts`, `src/app/settings/ai/**`, `src/app/globals.css`, `src/lib/tokens/tokens.ts`, `src/components/AppShell.tsx`, `src/app/settings/settings-nav.tsx`). Fold in Critical/High findings; note deferred Lows as WP candidates in the summary.

- [ ] **Step 4: Re-run typecheck + unit suite after fixes.** Expected: green.

---

## Task 13: Commit (owner-gated) + push (owner-gated)

- [ ] **Step 1: Print the filled PLAYBOOK §6 self-audit checklist + a WP summary** (files, tests added, review outcomes, deferred WP candidates). Confirm the throwaway gallery route is deleted and `git status` shows only intended files.

- [ ] **Step 2: Get explicit owner "go" to COMMIT.** Then stage + a SINGLE commit:

```bash
git add -A
git commit -m "feat(wp-ai-2): AI assistant widget + Settings→AI section (AIA-01..06, mockup rev-7)"
```

(End the message with the Co-Authored-By trailer per repo convention.)

- [ ] **Step 3: Get a SEPARATE explicit owner "go" to PUSH**, then `git push origin phase-2/distribution` (PR #1).

---

## Self-Review (author checklist — run after drafting, fix inline)

**Spec coverage (design doc §):**
- §1/§10 widget (launcher/panel/chips/sources/deeplinks/thumbs/cap/bulleted) → Tasks 5–8. ✓
- AIA-03 grounded UI (sources from tool parts) → Task 7 (`sourcesOf` + AssistantMessage). ✓
- AIA-04 feedback thumbs → Task 7 + Task 8 (`sendFeedback` → `/api/ai/feedback`). ✓
- AIA-05/PRN-10 deep-link whitelist → Task 7 (`isInternalPath`). ✓
- AIA-06/SET-11/BIL-04 cap state + Settings usage $ → Task 4 + Task 8 (band) + Task 10 (Settings). ✓
- PRN-12 tokens → Task 1 + token usage throughout; canvas palette documented carve-out. ✓
- Contextual chips (`suggestionsFor(screen)`, route-derived) → Task 2 + Task 8. ✓
- Reduced-motion + tab-hidden orb → Task 5. ✓
- Verify (Playwright, throwaway gallery, both themes) → Task 11. ✓
- Reviews (pr + design-system + a11y + frontend-arch) → Task 12. ✓

**Type consistency:** `AssistantGate` (Task 4) used in Task 8; `AssistantSource`/`AssistantMessageProps` (Task 7) used in Task 8; `AnswerBlock`/`InlineSpan` (Task 3) used in Task 7. Consistent.

**Open confirmations for the implementer (resolve against real code, do not guess):** Tailwind v4 `aria-pressed:` variant availability in this config (Task 7 thumbs — if unavailable, compute the pressed classes with a ternary on `rated`) · use `h-[26px] w-[26px]` (not the non-existent `h-6.5`) for the 26px thumb buttons · confirm `Skeleton` accepts a `className` (Task 10 loading state).
