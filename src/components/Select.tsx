"use client";

import * as React from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { cn } from "@/lib/cn";
import { FieldLabel } from "./FieldLabel";

// Select — the Radix-backed, controlled select (ADR-0016). Unlike the retained
// NativeSelect (event-based `onChange`), this takes a controlled `value` +
// `onValueChange`, styled entirely from tokens (PRN-12) with a visible focus ring.
// Pages migrate onto it during their rework (WS-2+); NativeSelect is retired at WS-8.

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Accessible label when no visible `label` is provided (e.g. rows-per-page). */
  ariaLabel?: string;
  /**
   * Paint the trigger's selected content instead of the option's plain text — for a value
   * that is more than a string (N5-06's partner control shows the swatch + name + ref ID).
   * The OPTION list is unaffected: its labels stay text, which is what Radix's typeahead and
   * the accessible name are built from.
   */
  renderValue?: (value: string) => React.ReactNode;
  /** Red asterisk / muted "(optional)" tag on the label (#27). */
  required?: boolean;
  optional?: boolean;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  label,
  error,
  hint,
  disabled,
  id,
  className,
  ariaLabel,
  renderValue,
  required,
  optional,
}: SelectProps) {
  const autoId = React.useId();
  const selectId = id ?? autoId;
  const describedBy = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <FieldLabel htmlFor={selectId} required={required} optional={optional}>
          {label}
        </FieldLabel>
      )}
      <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <RadixSelect.Trigger
          id={selectId}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy}
          className={cn(
            "inline-flex w-full items-center justify-between gap-2 rounded-md border bg-surface px-3 py-2 text-sm font-medium text-text-2",
            "outline-none transition-[border-color] duration-[120ms] focus-visible:ring-1 focus-visible:ring-brand-ink",
            "disabled:cursor-not-allowed disabled:opacity-60 data-[placeholder]:text-text-3",
            error ? "border-danger" : "border-border-soft focus-visible:border-brand-ink",
            className,
          )}
        >
          {/* Radix falls back to the selected item's text when Value has no children. */}
          <RadixSelect.Value placeholder={placeholder}>{renderValue ? renderValue(value) : undefined}</RadixSelect.Value>
          <RadixSelect.Icon className="text-text-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className="anim-pop z-[120] max-h-[--radix-select-content-available-height] min-w-[--radix-select-trigger-width] overflow-hidden rounded-md border border-border bg-surface shadow-md"
          >
            <RadixSelect.Viewport className="p-1">
              {options.map((o) => (
                <RadixSelect.Item
                  key={o.value}
                  value={o.value}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 pr-7 text-sm text-text outline-none",
                    "data-[highlighted]:bg-brand-soft data-[highlighted]:text-brand-ink",
                  )}
                >
                  <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="absolute right-2 text-brand-ink">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {error ? (
        <span id={`${selectId}-error`} className="text-xs text-danger">
          {error}
        </span>
      ) : hint ? (
        <span id={`${selectId}-hint`} className="text-xs text-text-3">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
