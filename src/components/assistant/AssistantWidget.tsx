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
import { AssistantIconButton } from "./AssistantIconButton";

const WELCOME = "Hi — I can answer questions about your workspace: partners, leads, coverage, imports, or what a screen does.";

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

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [gate, setGate] = React.useState<AssistantGate | null>(null);
  const [scrolled, setScrolled] = React.useState(false);
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
        ref={panelRef}
        id="assistant-panel"
        aria-label="Assistant"
        tabIndex={-1}
        inert={!open}
        className={
          "fixed bottom-[92px] right-6 z-50 flex h-[min(640px,calc(100vh-128px))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-[18px] border border-border bg-surface shadow-lg transition-all duration-200 max-[520px]:inset-x-2 max-[520px]:bottom-[88px] max-[520px]:h-[calc(100vh-104px)] max-[520px]:w-auto " +
          (open ? "opacity-100" : "pointer-events-none translate-y-3 scale-95 opacity-0")
        }
      >
        {/* Header */}
        <header className={"relative z-[2] flex flex-none items-center gap-3 border-b border-border-soft bg-[linear-gradient(180deg,var(--brand-soft),var(--surface)_130%)] px-4 py-3 transition-shadow " + (scrolled ? "shadow-md" : "")}>
          <Orb size={30} animate={open} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-step-3 leading-tight">Assistant</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-step-0 text-text-3">
              <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-success" />
              <span className="truncate">Answers from your workspace · not saved</span>
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

        {/* Transcript */}
        <div ref={scrollRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)} role="log" aria-live={busy ? "off" : "polite"} aria-relevant="additions" className="flex flex-1 flex-col gap-3 overflow-y-auto bg-bg px-3.5 pb-3 pt-4">
          {messages.length === 0 && (
            <>
              <AssistantMessage id="welcome" text={WELCOME} sources={[]} showThumbs={false} />
              <SuggestionChips items={suggestionsFor(screen)} onSelect={send} disabled={blocked || busy} />
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
            <div role="status" className="flex gap-1 self-start rounded-[15px] rounded-tl-[5px] border border-border-soft bg-surface px-3.5 py-3" aria-label="Assistant is thinking">
              <i className="h-1.5 w-1.5 animate-[blink_1s_infinite] rounded-full bg-text-3" />
              <i className="h-1.5 w-1.5 animate-[blink_1s_infinite_.18s] rounded-full bg-text-3" />
              <i className="h-1.5 w-1.5 animate-[blink_1s_infinite_.36s] rounded-full bg-text-3" />
            </div>
          )}
        </div>

        {/* Generic error band — gate codes also set `error` (non-ok response), so the
            `!blocked` guard ensures the gate band below wins for those and this band
            only shows for real transient failures. */}
        {!blocked && error && (
          <div role="alert" className="flex flex-none items-start gap-2.5 border-t border-border-soft bg-danger-soft px-3.5 py-2.5 text-step-1 text-text-2">
            <span aria-hidden className="grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] bg-danger text-step-0 font-bold text-on-status">!</span>
            <span>Something went wrong reaching the assistant. <button type="button" onClick={() => regenerate()} className="font-semibold text-brand-ink underline">Try again</button>{messages.length > 0 && <> or <button type="button" onClick={newChat} className="font-semibold text-brand-ink underline">start a new chat</button></>}.</span>
          </div>
        )}

        {/* Cap / rate / disabled band */}
        {blocked && (
          <div className="flex flex-none items-start gap-2.5 border-t border-border-soft bg-warn-soft px-3.5 py-2.5 text-step-1 text-text-2">
            <span aria-hidden="true" className="grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] bg-warn text-step-0 font-bold text-on-status">!</span>
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

      {/* Launcher — the orb (always gently animating) when closed; a plain close button
          when open, so exactly one orb is ever on screen (the panel header's). */}
      <button
        ref={launcherRef}
        type="button"
        aria-label={open ? "Close assistant" : "Open assistant"}
        aria-expanded={open}
        aria-controls="assistant-panel"
        onClick={() => setOpen((v) => !v)}
        className={
          "fixed bottom-6 right-6 z-40 grid h-[58px] w-[58px] place-items-center rounded-full border-none bg-transparent p-0 transition-transform duration-150 hover:scale-[1.06] active:scale-95 " +
          (open ? "" : "assistant-breathe")
        }
      >
        {open ? (
          <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-brand text-brand-contrast shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <Orb size={52} animate />
        )}
      </button>
    </>
  );
}
