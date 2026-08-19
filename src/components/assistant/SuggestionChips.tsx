"use client";

import * as React from "react";

export interface SuggestionChipsProps {
  items: string[];
  onSelect: (q: string) => void;
  disabled?: boolean;
  /** Section heading above the rows. Defaults to the empty-state's "Try asking"; the AIS-10
   *  follow-up row overrides it so a mid-conversation row doesn't read like a fresh start. */
  heading?: string;
  /** Accessible name of the button group — distinct per call site so screen-reader users (and
   *  tests) can tell the empty-state set from a follow-up row. */
  label?: string;
}

export function SuggestionChips({ items, onSelect, disabled, heading = "Try asking", label = "Suggested questions" }: SuggestionChipsProps) {
  if (items.length === 0) return null;
  return (
    <div className="self-stretch">
      <div className="mb-1.5 text-step-0 font-semibold uppercase tracking-[.08em] text-text-3">
        {heading}
      </div>
      {/* WP-AI-STYLE-PERSIST / redesign A5: full-width stacked ROWS, not a wrapping pill
          cloud — clearer "things you can ask", ≥40px touch targets that don't ragged-wrap at
          375px, and a leading arrow glyph so each reads as an action. */}
      <div role="group" aria-label={label} className="flex flex-col gap-1.5">
        {items.map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(q)}
            className="flex w-full items-center gap-2 rounded-md border border-border-soft bg-surface px-3 py-2 text-left text-step-1 text-text-2 shadow-xs outline-none transition-colors hover:border-brand-line hover:bg-brand-soft hover:text-brand-ink focus-visible:border-brand-line focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.99] disabled:pointer-events-none disabled:opacity-45"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-brand-ink">
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span className="min-w-0">{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
