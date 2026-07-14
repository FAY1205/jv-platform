"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Input } from "./Input";

// Combobox — a searchable single-select (T2, owner note #2: the state filter must be
// a searchable dropdown, not a 2-letter code box). Hand-rolled on the native input +
// ARIA 1.2 combobox pattern (same no-new-deps precedent as SegmentedControl/Switch;
// @radix-ui has no combobox). Typing filters the option labels; ArrowUp/Down + Enter
// select; Esc closes and reverts; clearing the text (or the ✕ button) clears the
// selection. DSN-03 states come from the composed Input (focus ring, disabled) plus
// hover/active styling on the options.

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** Selected option value; "" = nothing selected. */
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Combobox({ options, value, onValueChange, ariaLabel, placeholder, disabled, className }: ComboboxProps) {
  const listboxId = React.useId();
  const selected = options.find((o) => o.value === value) ?? null;

  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(selected?.label ?? "");
  const [active, setActive] = React.useState(0);

  // Keep the display text in sync when the selection changes from outside (e.g. "Clear all").
  const [syncedValue, setSyncedValue] = React.useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(selected?.label ?? "");
  }

  const q = text.trim().toLowerCase();
  // While the list is open, an untouched (still equal to the selection) text shows ALL
  // options — filtering by the selected label would strand the user on one row.
  const filtered = !q || text === selected?.label ? options : options.filter((o) => o.label.toLowerCase().includes(q));

  const close = React.useCallback(() => {
    setOpen(false);
    setActive(0);
  }, []);

  const select = (o: ComboboxOption) => {
    onValueChange(o.value);
    setText(o.label);
    close();
  };

  const clear = () => {
    onValueChange("");
    setText("");
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => Math.min(Math.max(a + delta, 0), Math.max(filtered.length - 1, 0)));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) {
        e.preventDefault();
        select(filtered[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setText(selected?.label ?? "");
        close();
      }
    }
  };

  const onBlur = () => {
    // Option mousedown preventDefault()s, so a click never races this blur.
    if (text.trim() === "") {
      if (value) onValueChange("");
      setText("");
    } else {
      setText(selected?.label ?? ""); // revert half-typed text to the real selection
    }
    close();
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listboxId}-${active}` : undefined}
        aria-label={ariaLabel}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        className="pr-8"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {value && !disabled ? (
        <button
          type="button"
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
          className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-text-3 transition-colors hover:text-text-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : (
        <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      )}
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          // preventDefault keeps focus in the input so blur doesn't fire before click.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-50 mt-1 max-h-64 w-full min-w-44 overflow-auto rounded-lg border border-border bg-surface py-1 shadow-md"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-1.5 text-sm text-text-3">No matches</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => select(o)}
                className={cn(
                  "cursor-pointer px-3 py-1.5 text-sm",
                  i === active ? "bg-brand-soft text-brand-ink" : "text-text-2",
                  o.value === value && "font-semibold",
                )}
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
