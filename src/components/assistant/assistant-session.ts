import type { UIMessage } from "ai";

// WP-AI-PERSIST: keep the assistant's conversation for the login session without a
// database (privacy: chat content never persists server-side). The panel now lives in
// the admin LAYOUT, so its open state + transcript already survive client-side
// navigation natively; this sessionStorage mirror adds survival across a hard refresh
// and clears when the tab closes — i.e. "saved for this session", nothing longer.

const OPEN_KEY = "jv.assistant.open";
const MSGS_KEY = "jv.assistant.messages";

/** Cap the persisted transcript so sessionStorage can't grow unbounded. */
const MAX_PERSISTED = 40;

function canUse(): boolean {
  return typeof window !== "undefined" && !!window.sessionStorage;
}

export function loadOpen(): boolean {
  if (!canUse()) return false;
  return window.sessionStorage.getItem(OPEN_KEY) === "1";
}

export function saveOpen(open: boolean): void {
  if (!canUse()) return;
  try {
    window.sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage full / disabled — persistence is best-effort, never break the widget.
  }
}

export function loadMessages(): UIMessage[] {
  if (!canUse()) return [];
  try {
    const raw = window.sessionStorage.getItem(MSGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveMessages(messages: UIMessage[]): void {
  if (!canUse()) return;
  try {
    window.sessionStorage.setItem(MSGS_KEY, JSON.stringify(messages.slice(-MAX_PERSISTED)));
  } catch {
    // Ignore quota/serialization failures — the live in-memory transcript is unaffected.
  }
}

export function clearSession(): void {
  if (!canUse()) return;
  try {
    window.sessionStorage.removeItem(OPEN_KEY);
    window.sessionStorage.removeItem(MSGS_KEY);
  } catch {
    // no-op
  }
}
