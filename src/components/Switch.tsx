"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// Switch (DSN-03) — a controlled on/off toggle for a single boolean (e.g. whether an
// MLS filter phrase runs). Hand-rolled on a native <button role="switch"> — the ARIA
// switch pattern — so Space/Enter toggle come for free and no new dependency is added
// (mirrors SegmentedControl; ADR-0016's Radix primitives aren't needed for this).
// On-state is the marigold brand FILL (WP-C intent: "toggle switches, on-state=route").
// All colors are tokens (PRN-12). `loading` is n/a — a toggle is synchronous; the
// consuming page owns any async state (same as SegmentedControl).
//
// A11y: the knob carries a `ring-text-2` edge so it clears WCAG 1.4.11 (≥3:1) against
// both the OFF track (surface-3) and the ON track (marigold) in both themes — a bare
// surface-on-surface-3/marigold knob was only ~1.3–2.5:1. Press scales the knob (a
// physical-toggle metaphor) rather than the whole control, unlike Button/SegmentedControl.

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Optional visible label; clicking it toggles the switch (native <label for>). */
  label?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Accessible name when no visible `label` is provided. */
  ariaLabel?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, id, className, ariaLabel }: SwitchProps) {
  const autoId = React.useId();
  const switchId = id ?? autoId;

  const control = (
    <button
      type="button"
      role="switch"
      id={switchId}
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group relative inline-flex h-[26px] w-11 shrink-0 rounded-full border outline-none transition-colors",
        "focus-visible:ring-1 focus-visible:ring-brand-ink",
        "disabled:cursor-not-allowed disabled:opacity-60",
        checked
          ? "border-brand-strong bg-brand hover:bg-brand-strong"
          : "border-border-strong bg-surface-3 hover:border-text-3",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow-sm ring-1 ring-inset ring-text-2",
          "transition-transform duration-200 ease-out group-active:scale-90",
          checked ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );

  if (!label) return control;
  return (
    <label htmlFor={switchId} className={cn("inline-flex items-center gap-2.5", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      {control}
      <span className={cn("text-sm text-text", disabled && "opacity-60")}>{label}</span>
    </label>
  );
}
