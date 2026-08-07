"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// RadioGroup (DSN-03) — a tokened single-select for vertical, mutually exclusive choices,
// replacing the ad-hoc native `<input type="radio">` pair in the deactivate/reassign dialog
// (audit design-system F-1: the one interactive control that bypassed the design system, on a
// destructive admin flow). Hand-rolled with no new dependency, like SegmentedControl / Switch /
// Combobox. Proper semantics: role="radiogroup" of role="radio" items, aria-checked, a bound
// text label (PRN-14: meaning never rides on the fill alone), and the DSN-03 interactive states
// (default / hover / focus-visible / active / disabled). Compositional so callers can interleave
// a reveal (e.g. the partner picker under "reassign") between items.
//
// Each item is an independent tab stop (Space/Enter/click selects) rather than the roving-
// tabindex + arrow-key pattern — matching SegmentedControl's simpler group model; every item is
// keyboard-reachable and screen-reader-announced as a radio.

interface RadioGroupContextValue {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Required accessible name for the group. */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function RadioGroup({ value, onValueChange, ariaLabel, disabled, className, children }: RadioGroupProps) {
  const ctx = React.useMemo(() => ({ value, onValueChange, disabled }), [value, onValueChange, disabled]);
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("flex flex-col gap-2", className)}>
      <RadioGroupContext.Provider value={ctx}>{children}</RadioGroupContext.Provider>
    </div>
  );
}

export interface RadioGroupItemProps {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function RadioGroupItem({ value, label, disabled: itemDisabled, className }: RadioGroupItemProps) {
  const ctx = React.useContext(RadioGroupContext);
  if (!ctx) throw new Error("RadioGroupItem must be used within <RadioGroup>");
  const checked = ctx.value === value;
  const disabled = ctx.disabled || itemDisabled;
  const select = () => {
    if (!disabled) ctx.onValueChange(value);
  };
  return (
    <div
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={select}
      onKeyDown={(e) => {
        if (!disabled && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          select();
        }
      }}
      className={cn(
        "group inline-flex items-center gap-2 rounded-md text-sm text-text outline-none",
        "focus-visible:ring-1 focus-visible:ring-brand-ink",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded-full border bg-surface transition-colors",
          checked ? "border-brand" : "border-border",
          !disabled && !checked && "group-hover:border-text-3",
          !disabled && "group-active:scale-95",
        )}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-brand" />}
      </span>
      <span>{label}</span>
    </div>
  );
}
