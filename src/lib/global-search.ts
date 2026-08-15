// ─────────────────────────────────────────────────────────────────────────────
// Global search (SRCH-02) — the client-side glue, kept pure and framework-free so
// the hotkey rule and the highlight splitter are unit-testable without a DOM.
// ─────────────────────────────────────────────────────────────────────────────

/** Window event the topbar trigger fires; the overlay (mounted once in the (admin)
 *  layout) listens for it. A DOM event rather than a store: the trigger lives inside
 *  AppShell and the overlay outside it, and neither needs to know the other exists. */
export const GLOBAL_SEARCH_OPEN_EVENT = "jv:global-search-open";

/** Ask the mounted overlay to open (topbar trigger). No-op outside the browser. */
export function requestGlobalSearch(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(GLOBAL_SEARCH_OPEN_EVENT));
}

/** Ctrl-K / ⌘-K (SRCH-02). Alt-modified chords belong to the OS/browser, not us. */
export function isGlobalSearchHotkey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k";
}

/** One run of result text, flagged as a query match or not. */
export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * SRCH-02 — split `text` into matched / unmatched runs for the highlighted fragment.
 *
 * The result text is DATA (PRN-10): it is rendered as React children (a <mark> per
 * matched run), NEVER as innerHTML/dangerouslySetInnerHTML, so a lead whose address
 * contains markup shows that markup as text. The match is a literal, case-insensitive
 * substring scan — no regex is built from user input, so a query like `.*` or `(` is
 * matched literally and cannot blow up (or backtrack) on the client.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const needle = query.trim().toLowerCase();
  if (!text || !needle) return text ? [{ text, match: false }] : [];

  const hay = text.toLowerCase();
  const parts: HighlightPart[] = [];
  let at = 0;
  for (;;) {
    const hit = hay.indexOf(needle, at);
    if (hit === -1) break;
    if (hit > at) parts.push({ text: text.slice(at, hit), match: false });
    parts.push({ text: text.slice(hit, hit + needle.length), match: true });
    at = hit + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
