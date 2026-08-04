import * as React from "react";
import { cn } from "@/lib/cn";

// SegmentedControl (DSN-03) — a single-select toggle group for short, mutually
// exclusive choices (e.g. a dashboard time range). All values come from tokens
// (PRN-12); the selected segment is route-tinted. Implements the DSN-03 interactive
// states that apply to a stateless toggle group: default / hover / focus-visible /
// active (press) / disabled. `loading` is n/a — a segment selection is synchronous;
// the consuming page owns any async state. Accessibility mirrors the mockup: a
// labeled role="group" of buttons, each with aria-pressed.

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentOption<T>[];
  /** Required accessible name for the group (no visible label). */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-[color,background-color,transform] duration-[120ms]",
              "focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.98] disabled:pointer-events-none disabled:opacity-50",
              on ? "bg-brand-soft font-semibold text-brand-ink" : "text-text-2 hover:bg-surface-3 hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
