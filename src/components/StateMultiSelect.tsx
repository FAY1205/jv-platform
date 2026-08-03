"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Input } from "./Input";
import { US_STATES } from "@/lib/us-states";

// WP-C (owner note #1): a searchable multi-select for whole-state coverage. Picking from the
// canonical 50-state + DC list means an invalid state is impossible by construction — no
// free-text parsing, no "Texas vs TX vs 3-letter typo", no multi-word-name edge cases. Built on
// the same native-input + ARIA combobox pattern as Combobox (no new deps); the listbox's
// mousedown-preventDefault keeps focus on the input so several states can be added in a row.

export interface StateMultiSelectProps {
  /** Selected 2-letter codes. */
  selected: readonly string[];
  onChange: (codes: string[]) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

export function StateMultiSelect({ selected, onChange, ariaLabel = "Add states", disabled }: StateMultiSelectProps) {
  const listboxId = React.useId();
  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  const selectedSet = new Set(selected);
  const q = text.trim().toLowerCase();
  const available = US_STATES.filter((s) => !selectedSet.has(s.code));
  const filtered = q
    ? available.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
    : available;

  const add = (code: string) => {
    if (selectedSet.has(code)) return;
    onChange([...selected, code]);
    setText("");
    setActive(0);
  };
  const remove = (code: string) => onChange(selected.filter((c) => c !== code));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => Math.min(Math.max(a + delta, 0), Math.max(filtered.length - 1, 0)));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) {
        e.preventDefault();
        add(filtered[active].code);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === "Backspace" && text === "" && selected.length > 0) {
      // Quick removal of the last chip, mirroring common tag-input behavior.
      remove(selected[selected.length - 1]);
    }
  };

  return (
    <div>
      <div className="relative">
        <Input
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${listboxId}-${active}` : undefined}
          aria-label={ariaLabel}
          value={text}
          placeholder="Search states…"
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
        {open && !disabled && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            // preventDefault keeps focus in the input, so adding one state doesn't blur-close
            // the list — you can add several in a row.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-md"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-1.5 text-sm text-text-3">No matches</li>
            ) : (
              filtered.map((s, i) => (
                <li
                  key={s.code}
                  id={`${listboxId}-${i}`}
                  role="option"
                  aria-selected={false}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(s.code)}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 text-sm",
                    i === active ? "bg-brand-soft text-brand-ink" : "text-text-2",
                  )}
                >
                  {s.name} <span className="num text-text-3">({s.code})</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {selected.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Selected states">
          {selected.map((code) => (
            <li
              key={code}
              className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-2"
            >
              <span className="num">{code}</span>
              <button
                type="button"
                aria-label={`Remove ${code}`}
                disabled={disabled}
                onClick={() => remove(code)}
                className="grid h-4 w-4 place-items-center rounded-full text-text-3 transition-colors hover:text-danger focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
