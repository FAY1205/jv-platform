"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./DropdownMenu";

// WP-UX-6 (owner direction 2026-08-16) — the status filter as a MULTI-SELECT, replacing
// the 7-pill row. The default (all workflow statuses on) is a wall of active amber chips
// that carries no signal (the audit's refined finding). Instead: one calm trigger that
// SUMMARIZES the selection ("Status: All active" / "New + Contacted" / "3 of 7"), a
// checkbox menu behind it, and deviations-from-default rendered as removable ✕-chips in
// the same grammar as the tag filter beside it. Generic over its options so the admin and
// portal filter rows share ONE control (options + default passed by the caller).

export interface StatusFilterMenuProps {
  /** All selectable statuses, in display order. */
  options: readonly string[];
  /** The "nothing changed" selection — its own set is the calm default. */
  defaultValue: readonly string[];
  /** Currently selected statuses. */
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

export function StatusFilterMenu({ options, defaultValue, value, onChange, className }: StatusFilterMenuProps) {
  const isDefault = sameSet(value, defaultValue);
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  // Deviation chips render in OPTIONS order (stable), not click order.
  const selectedInOrder = options.filter((s) => value.includes(s));

  const summary = isDefault
    ? "All active"
    : value.length === 0
      ? "Any status"
      : selectedInOrder.length <= 2
        ? selectedInOrder.join(" + ")
        : `${value.length} of ${options.length}`;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold outline-none transition-colors",
              "focus-visible:ring-1 focus-visible:ring-brand-ink data-[state=open]:border-brand-line",
              isDefault
                ? "border-border bg-surface text-text-2 hover:border-brand-line hover:text-text"
                : "border-brand bg-brand-soft text-brand-ink",
            )}
          >
            <span className="text-text-3">Status:</span> {summary}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[13rem]">
          <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
          {options.map((s) => (
            <DropdownMenuCheckboxItem
              key={s}
              checked={value.includes(s)}
              // Keep the menu OPEN so several can be toggled in one pass.
              onSelect={(e) => {
                e.preventDefault();
                toggle(s);
              }}
            >
              {s}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={isDefault}
            onSelect={() => onChange([...defaultValue])}
            className="text-brand-ink data-[disabled]:text-text-3"
          >
            Reset to default
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Deviation chips — the tag-filter grammar (removable ✕), only when off-default.
          Selecting NONE ("Any status") is one summary chip that resets; a narrowed set
          shows one chip per selected status. */}
      {!isDefault &&
        (value.length === 0 ? (
          <StatusChip label="Any status" onRemove={() => onChange([...defaultValue])} />
        ) : (
          selectedInOrder.map((s) => <StatusChip key={s} label={s} onRemove={() => toggle(s)} />)
        ))}
    </div>
  );
}

/** A neutral removable chip — the status analogue of TagChip (which is palette-colored). */
function StatusChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 py-0.5 pl-2 pr-1 text-xs font-semibold text-text-2">
      {label}
      <button
        type="button"
        aria-label={`Remove status ${label}`}
        onClick={onRemove}
        className="-mr-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full outline-none transition-colors hover:bg-surface-3 hover:text-text focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-95"
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}
