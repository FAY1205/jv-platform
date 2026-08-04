# WP-AI-STYLE + WP-AI-PERSIST: Assistant reply quality + session persistence
Spec: AIA-03/04, PRN-10, SEC-05 · Phase: post-2 · Tier: B

## Goal
Fix the assistant's reply quality (no blank replies, no raw paths, clearer chips, better
tone) and make the chat panel + transcript survive navigation and refresh for the session.

## WP-AI-STYLE
- [x] Prompt (`src/modules/ai/prompt.ts`): answer-first, lead-with-**bold**-number,
      1–3 sentences, at-least-one-sentence (never a link-only/blank reply), state zeros
      plainly; NEVER write a URL/path in prose — the nav chip is added automatically.
- [x] `AssistantMessage`: never-blank body — real text, else a "Checking your workspace…"
      pending state while a tool runs, else a fallback sentence built from the sources.
- [x] Chips read "From: <source>"; the deep-link pill reads "Open <label> →".
- Tests: `tests/unit/assistant-message.test.tsx`, `ai-prompt.test.ts`.

## WP-AI-PERSIST
- [x] Widget moved from per-page `AppShell` to the admin **layout** (`AssistantMount`),
      which persists across client navigation — panel + transcript stay put.
- [x] `assistant-session.ts`: sessionStorage mirror of open state + transcript, so both
      survive a hard refresh and clear when the tab closes ("saved for this session").
      No chat content persisted server-side (privacy). Header copy updated.
- [x] Kept the 24-message cap + last-12-replay cost guards.
- Tests: `tests/unit/components/assistant-mount.test.tsx`, widget tests isolated with
  `sessionStorage.clear()`.

## Out of scope (WP candidates)
- Clear the session mirror on logout (currently per-tab only).
- A read-only "show my hot leads" AI tool once scoring is live.
- Streaming per-tool progress labels (beyond the single "checking" state).
