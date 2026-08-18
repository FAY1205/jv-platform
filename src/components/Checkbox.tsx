"use client";

import * as React from "react";
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { cn } from "@/lib/cn";

// Checkbox — Radix-backed (ADR-0016), replacing the ad-hoc `<input type=checkbox>` sites
// (F-62). Controlled `checked` / `onCheckedChange`, an optional bound label, tokened box
// + check indicator, and a visible focus-visible ring.

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: React.ReactNode;
  /** NATIVE disabled — use for TRANSIENT states (a request in flight). Removes the control
   *  from the tab order, so never use it to express a standing permission: the reason a
   *  control is inert must stay reachable by keyboard (see `ariaDisabled`). */
  disabled?: boolean;
  /**
   * PERMANENT inert state (a11y F-1, team-page precedent): the box stays focusable and keeps
   * its accessible name, reports `aria-disabled`, and swallows activation — so a keyboard
   * user can tab to it and hear the tooltip that explains why. Pair it with a Tooltip and
   * the `aria-describedby` pass-through below.
   */
  ariaDisabled?: boolean;
  id?: string;
  className?: string;
  /** Accessible label when no visible `label` is provided. */
  ariaLabel?: string;
  /** Pass-through so a wrapping Tooltip's bubble id lands on the CONTROL a screen reader
   *  focuses, not on an outer label element (a11y F-2). Tooltip clones this onto its direct
   *  child, so this component must be that child. */
  "aria-describedby"?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  ariaDisabled,
  id,
  className,
  ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: CheckboxProps) {
  const autoId = React.useId();
  const boxId = id ?? autoId;
  const box = (
    <RadixCheckbox.Root
      id={boxId}
      checked={checked}
      // aria-disabled means inert: the control is controlled, so swallowing the change here
      // is the whole block — pointer, Space and Enter all arrive through this one callback.
      onCheckedChange={(v) => {
        if (ariaDisabled) return;
        onCheckedChange(v === true);
      }}
      disabled={disabled}
      aria-disabled={ariaDisabled || undefined}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={cn(
        "grid h-4 w-4 place-items-center rounded border outline-none transition-colors",
        "focus-visible:ring-1 focus-visible:ring-brand-ink",
        "data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:hover:bg-brand-strong",
        "data-[state=unchecked]:border-border data-[state=unchecked]:bg-surface data-[state=unchecked]:hover:border-text-3",
        "disabled:cursor-not-allowed disabled:opacity-60",
        // Same treatment as native disabled, minus the tab-order removal.
        ariaDisabled && "cursor-not-allowed opacity-60 data-[state=checked]:hover:bg-brand data-[state=unchecked]:hover:border-border",
        className,
      )}
    >
      <RadixCheckbox.Indicator className="text-brand-contrast">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );

  if (!label) return box;
  return (
    <label htmlFor={boxId} className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-text", disabled && "cursor-not-allowed opacity-60")}>
      {box}
      {label}
    </label>
  );
}
