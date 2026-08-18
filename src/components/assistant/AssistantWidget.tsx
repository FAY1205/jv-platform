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
import { MiniOrb } from "./MiniOrb";
import { SuggestionChips } from "./SuggestionChips";
import { AssistantMessage, AssistantMarker, type AssistantSource } from "./AssistantMessage";
import { AssistantIconButton } from "./AssistantIconButton";
import { loadOpen, saveOpen, loadMessages, saveMessages } from "./assistant-session";

// Empty state (title-page composition, not a fake message): a heading in the display face +
// this sub-line describing scope.
const EMPTY_HEADING = "Ask your workspace";
const EMPTY_SUBLINE = "Partners, leads, coverage, imports — or what any screen does.";
// The chat route caps history at 24 messages (ChatBodySchema); nudge toward "New chat" before
// the user hits the resulting error band.
const CAP_NUDGE_AT = 20;

/** Exhaustive gate-band copy (E): a future 4th AssistantGate value fails to compile here
 *  instead of silently rendering a blank band. */
function gateBandCopy(gate: AssistantGate): React.ReactNode {
  switch (gate) {
    case "budget":
      return (<>You&rsquo;ve used this month&rsquo;s AI allowance. Raise the limit in <Link href="/settings/ai" className="font-semibold text-brand-ink">Settings → AI assistant</Link>.</>);
    case "rate":
      return (<>That&rsquo;s a lot of questions at once — give it a minute and try again.</>);
    case "disabled":
      return (<>The assistant is switched off. Turn it on in <Link href="/settings/ai" className="font-semibold text-brand-ink">Settings → AI assistant</Link>.</>);
    default: {
      const _exhaustive: never = gate;
      return _exhaustive;
    }
  }
}

export default function AssistantWidget() {
  const path = usePathname() ?? "";
  const screen = screenForPath(path);

  // Open state restores from the session mirror so a hard refresh reopens the panel
  // (WP-AI-PERSIST). Across client navigation it persists natively — the widget now
  // lives in the admin layout, which doesn't remount.
  const [open, setOpen] = React.useState<boolean>(loadOpen);
  const [draft, setDraft] = React.useState("");
  const [gate, setGate] = React.useState<AssistantGate | null>(null);
  const [scrolled, setScrolled] = React.useState(false);
  // Smart scroll-pinning: only auto-follow the newest message when the user is already near
  // the bottom; otherwise show a "Jump to latest" pill (so re-reading a restored transcript
  // isn't yanked back mid-stream). `atBottom` starts true (a fresh/short transcript is pinned).
  const [atBottom, setAtBottom] = React.useState(true);
  // How many messages were restored from the session mirror on mount — drives the "Earlier in
  // this session" divider + the header's "Restored" sub-line. Read once from the same mirror the
  // seed effect below loads (a lazy initializer, not a setState-in-effect); 0 for a fresh session.
  const [restoredCount] = React.useState(() => loadMessages().length);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const launcherRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const wantsInputFocusRef = React.useRef(false);

  const gateFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    if (!res.ok) {
      const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
      const g = gateStateFromCode(body?.code);
      if (g) setGate(g);
    }
    return res;
  };

  const { messages, status, sendMessage, error, regenerate, setMessages, clearError, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      fetch: gateFetch,
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { messages, screen },
        headers: csrfHeaders(),
      }),
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  const blocked = gate !== null;

  // WP-AI-PERSIST: mirror open state + transcript to sessionStorage so both survive a
  // hard refresh and clear when the tab closes ("saved for this session"). Seed once on
  // mount (covers a refresh); after that the live transcript is the source of truth.
  React.useEffect(() => { saveOpen(open); }, [open]);
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const saved = loadMessages();
    if (saved.length > 0) setMessages(saved); // restoredCount was captured from the same mirror
  }, [setMessages]);
  React.useEffect(() => { saveMessages(messages); }, [messages]);

  // Start over: the chat route caps history at 24 messages (ChatBodySchema), so a long
  // session eventually 400s. "New chat" lets the user reset the transcript before/at that
  // cap. Also aborts any in-flight stream and clears a transient error or a stale gate flag
  // (the server re-gates the next turn if the cap/rate/disabled condition still holds).
  const newChat = () => {
    stop();
    setMessages([]);
    clearError();
    setGate(null);
    setDraft("");
    // "New chat" is clickable mid-stream (it interrupts via stop()), so the composer
    // may still be `disabled` this tick and this button is about to unmount (messages→0).
    // Focusing a disabled input silently no-ops → focus would drop to <body>. Fall back to
    // the panel, then move into the composer once it's actually enabled (effect below).
    if (inputRef.current && !inputRef.current.disabled) {
      inputRef.current.focus();
    } else {
      panelRef.current?.focus();
      wantsInputFocusRef.current = true;
    }
  };

  // Deferred composer focus after a mid-stream "New chat": once the stream aborts
  // (busy clears) and no gate blocks input, move focus from the panel into the composer.
  React.useEffect(() => {
    if (wantsInputFocusRef.current && !blocked && !busy) {
      wantsInputFocusRef.current = false;
      inputRef.current?.focus();
    }
  }, [blocked, busy]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || blocked || busy) return;
    setDraft("");
    void sendMessage({ text: t });
  };

  const sendFeedback = (id: string, rating: "up" | "down") => {
    // Optimistic: the UI confirms immediately (feedback is low-stakes). Log failures so they aren't invisible.
    void apiMutate("/api/ai/feedback", "POST", { messageId: id, rating }).catch((e) => console.error("ai_feedback_failed", e));
  };

  // autofocus on open; Escape closes; focus returns to the launcher when the panel closes
  // (it becomes inert, so focus must not silently drop to <body>).
  React.useEffect(() => {
    if (!open) return;
    const launcher = launcherRef.current; // capture at open (stable element) so cleanup refocuses it
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); launcher?.focus(); };
  }, [open]);

  // Smart pinning: follow the newest message ONLY when the user is already near the bottom.
  // If they scrolled up (to re-read a restored transcript), leave them there and surface the
  // "Jump to latest" pill instead of yanking the view down mid-stream.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [messages, busy, atBottom]);

  const NEAR_BOTTOM_PX = 80;
  const onTranscriptScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrolled(el.scrollTop > 4);
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
  };
  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

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
        ref={panelRef}
        id="assistant-panel"
        aria-label="Assistant"
        tabIndex={-1}
        inert={!open}
        className={[
          "fixed z-50 flex flex-col overflow-hidden border border-border bg-surface shadow-lg transition-all duration-200",
          // Desktop: a docked panel that grows out of the orb (origin bottom-right).
          "bottom-[92px] right-6 h-[min(640px,calc(100vh-128px))] w-[min(416px,calc(100vw-24px))] rounded-lg origin-bottom-right",
          // Mobile ≤520px: a true bottom sheet (dvh, keyboard-safe) that slides up.
          "max-[520px]:inset-x-0 max-[520px]:bottom-0 max-[520px]:right-0 max-[520px]:h-[min(85dvh,640px)] max-[520px]:w-auto max-[520px]:rounded-b-none max-[520px]:origin-bottom",
          open
            ? "opacity-100 translate-y-0 scale-100"
            : "pointer-events-none opacity-0 translate-y-3 scale-95 max-[520px]:translate-y-full max-[520px]:scale-100 max-[520px]:opacity-100",
        ].join(" ")}
      >
        {/* Header */}
        <header className={"relative z-[2] flex flex-none items-center gap-3 border-b border-border-soft bg-[linear-gradient(180deg,var(--brand-soft),var(--surface)_130%)] px-4 py-3 transition-shadow " + (scrolled ? "shadow-md" : "")}>
          {/* Bottom-sheet grab affordance (mobile only, decorative — Esc / close button remain
              the controls). */}
          <span aria-hidden="true" className="absolute left-1/2 top-1.5 hidden h-1 w-9 -translate-x-1/2 rounded-full bg-border-strong max-[520px]:block" />
          <MiniOrb size={30} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-step-3 leading-tight">Assistant</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-step-0 text-text-3">
              {/* PRN-14: the dot has the word "Online" beside it (not colour alone). When the
                  transcript was restored on refresh, say so until the next message. */}
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-success" />
              <span className="truncate">
                {restoredCount > 0 && messages.length <= restoredCount ? "Restored · saved for this session" : "Online · saved for this session"}
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {messages.length > 0 && (
              <AssistantIconButton variant="ghost" aria-label="New chat" onClick={newChat}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </AssistantIconButton>
            )}
            <AssistantIconButton variant="ghost" aria-label="Close assistant" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </AssistantIconButton>
          </div>
        </header>

        {/* Transcript (relative so the Jump-to-latest pill can float over it) */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} onScroll={onTranscriptScroll} role="log" aria-live={busy ? "off" : "polite"} aria-relevant="additions" className="flex flex-1 flex-col gap-3 overflow-y-auto bg-bg px-3.5 pb-3 pt-4">
            {messages.length === 0 ? (
              // Empty = a title-page composition, not a fake first message.
              <div className="flex flex-1 flex-col items-center px-3 pt-8 text-center">
                <MiniOrb size={40} />
                <h2 className="mt-4 font-display text-step-4 leading-tight text-text">{EMPTY_HEADING}</h2>
                <p className="mt-1.5 text-step-1 text-text-3">{EMPTY_SUBLINE}</p>
                <div className="mt-6 w-full">
                  <SuggestionChips items={suggestionsFor(screen)} onSelect={send} disabled={blocked || busy} />
                </div>
              </div>
            ) : (
              <>
                {/* A restored transcript gets one divider above it — "there's history here". */}
                {restoredCount > 0 && (
                  <div className="relative my-1 flex items-center justify-center" aria-hidden="true">
                    <span className="absolute inset-x-0 top-1/2 border-t border-border-soft" />
                    <span className="relative bg-bg px-2 text-step-0 text-text-3">Earlier in this session</span>
                  </div>
                )}
                {messages.map((m, i) => {
                  const firstOfRun = i === 0 || messages[i - 1].role !== m.role;
                  return m.role === "user" ? (
                    <div key={m.id} className="mt-1 max-w-[90%] self-end rounded-md rounded-br-xs border border-brand-line bg-brand-soft px-3 py-2.5 text-step-2 leading-relaxed text-text">
                      {textOf(m)}
                    </div>
                  ) : (
                    <AssistantMessage key={m.id} id={m.id} text={textOf(m)} sources={sourcesOf(m)} onFeedback={sendFeedback} pending={busy && i === messages.length - 1} firstOfRun={firstOfRun} />
                  );
                })}
                {/* Thinking — a branded marker row, flat, not a boxed 3-dot bubble. */}
                {busy && messages[messages.length - 1]?.role === "user" && (
                  <div role="status" aria-label="Assistant is thinking" className="flex flex-col gap-1.5 self-stretch">
                    <AssistantMarker />
                    <div className="flex items-center gap-2 pl-[26px] text-step-1 text-text-3">
                      <span>Checking your workspace</span>
                      <span className="flex gap-1" aria-hidden="true">
                        <i className="h-1 w-1 animate-[blink_1s_infinite] rounded-full bg-text-3" />
                        <i className="h-1 w-1 animate-[blink_1s_infinite_.18s] rounded-full bg-text-3" />
                        <i className="h-1 w-1 animate-[blink_1s_infinite_.36s] rounded-full bg-text-3" />
                      </span>
                    </div>
                  </div>
                )}
                {/* Cap nudge — steer to a new chat BEFORE the 24-message route cap 400s. */}
                {messages.length >= CAP_NUDGE_AT && (
                  <div className="mt-1 text-center text-step-0 text-text-3">
                    Long chat — answers may lose early context.{" "}
                    <button type="button" onClick={newChat} className="rounded font-semibold text-brand-ink underline underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink">Start a new chat</button>
                  </div>
                )}
              </>
            )}
          </div>
          {/* Jump to latest — only when scrolled up in a non-empty transcript. */}
          {!atBottom && messages.length > 0 && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute bottom-3 left-1/2 z-[3] inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-step-1 font-semibold text-text-2 shadow-md outline-none transition-colors hover:border-border-strong focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-95"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
              Jump to latest
            </button>
          )}
        </div>

        {/* Generic error band — gate codes also set `error` (non-ok response), so the
            `!blocked` guard ensures the gate band below wins for those and this band
            only shows for real transient failures. */}
        {!blocked && error && (
          <div role="alert" className="flex flex-none items-start gap-2.5 border-t border-border-soft bg-danger-soft px-3.5 py-2.5 text-step-1 text-text-2">
            <span aria-hidden className="grid h-[18px] w-[18px] flex-none place-items-center rounded-xs bg-danger text-step-0 font-bold text-on-status">!</span>
            <span>Something went wrong reaching the assistant. <button type="button" onClick={() => regenerate()} className="font-semibold text-brand-ink underline">Try again</button>{messages.length > 0 && <> or <button type="button" onClick={newChat} className="font-semibold text-brand-ink underline">start a new chat</button></>}.</span>
          </div>
        )}

        {/* Cap / rate / disabled band */}
        {blocked && (
          <div className="flex flex-none items-start gap-2.5 border-t border-border-soft bg-warn-soft px-3.5 py-2.5 text-step-1 text-text-2">
            <span aria-hidden="true" className="grid h-[18px] w-[18px] flex-none place-items-center rounded-xs bg-warn text-step-0 font-bold text-on-status">!</span>
            <span>{gateBandCopy(gate!)}</span>
          </div>
        )}

        {/* Composer */}
        <footer className="relative z-[2] flex-none border-t border-border-soft bg-surface px-3.5 py-3 shadow-up">
          <div className="flex items-center gap-1.5 rounded-full border border-border-soft bg-bg py-1 pl-4 pr-1 transition-colors focus-within:border-brand-ink">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              disabled={blocked || busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(draft); }}
              placeholder="Ask about leads, partners, coverage…"
              aria-label="Ask the assistant"
              className="flex-1 border-none bg-transparent py-1.5 text-step-2 text-text outline-none placeholder:text-text-3 disabled:opacity-50"
            />
            <AssistantIconButton variant="primary" aria-label="Send" loading={busy} disabled={blocked || draft.trim() === ""} onClick={() => send(draft)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </AssistantIconButton>
          </div>
        </footer>
      </section>

      {/* Launcher — the orb (always gently breathing) when closed; a brand X disc when open,
          so exactly one orb is ever on screen (the panel header's MiniOrb). */}
      <button
        ref={launcherRef}
        type="button"
        // PRN-14: when the assistant is gated (cap/rate/disabled) and closed, the attention
        // dot's meaning is carried by the LABEL, not the colour alone.
        aria-label={open ? "Close assistant" : blocked ? "Open assistant — attention needed" : "Open assistant"}
        aria-expanded={open}
        aria-controls="assistant-panel"
        onClick={() => setOpen((v) => !v)}
        className={
          "group fixed bottom-6 right-6 z-40 grid h-[58px] w-[58px] place-items-center rounded-full border-none bg-transparent p-0 transition-transform duration-150 hover:scale-[1.06] active:scale-95 " +
          (open ? "" : "assistant-breathe")
        }
      >
        {/* "Ask" hover label — pointer devices only, so it never flashes on a touch tap. */}
        {!open && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1 text-step-1 font-semibold text-text-2 opacity-0 shadow-md transition-opacity duration-150 [@media(hover:hover)]:group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            Ask
          </span>
        )}
        {open ? (
          <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-brand text-brand-contrast shadow-md">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span className="relative">
            <Orb size={52} animate />
            {/* Attention dot when gated + closed. */}
            {blocked && <span aria-hidden="true" className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-warn ring-2 ring-bg" />}
          </span>
        )}
      </button>
    </>
  );
}
