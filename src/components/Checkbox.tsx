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
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Accessible label when no visible `label` is provided. */
  ariaLabel?: string;
}

export function Checkbox({ checked, onCheckedChange, label, disabled, id, className, ariaLabel }: CheckboxProps) {
  const autoId = React.useId();
  const boxId = id ?? autoId;
  const box = (
    <RadixCheckbox.Root
      id={boxId}
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      className={cn(
        "grid h-4 w-4 place-items-center rounded border outline-none transition-colors",
        "focus-visible:ring-1 focus-visible:ring-brand-ink",
        "data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:hover:bg-brand-strong",
        "data-[state=unchecked]:border-border data-[state=unchecked]:bg-surface data-[state=unchecked]:hover:border-text-3",
        "disabled:cursor-not-allowed disabled:opacity-60",
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
