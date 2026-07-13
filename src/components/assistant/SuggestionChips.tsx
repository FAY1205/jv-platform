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
