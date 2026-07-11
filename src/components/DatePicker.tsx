"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/lib/cn";

// DatePicker — a Radix Popover trigger + react-day-picker calendar (ADR-0016). Emits
// an ISO `yyyy-mm-dd` string (or null); parses/formats in LOCAL time so the calendar
// day never shifts across a timezone. Styled from tokens (PRN-12); the selected day is
// overridden to the brand color so react-day-picker's default palette never shows.

/** yyyy-mm-dd → local Date (no timezone shift). */
export function isoToDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
/** local Date → yyyy-mm-dd. */
export function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function formatHuman(iso: string | null): string {
  const d = isoToDate(iso);
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}

/** Shared token styling for react-day-picker (both single + range pickers). */
export const dayPickerClassNames = {
  selected: "!bg-brand !text-brand-contrast !rounded-md",
  today: "font-bold text-brand-ink",
  chevron: "fill-text-2",
  range_start: "!bg-brand !text-brand-contrast !rounded-l-md",
  range_end: "!bg-brand !text-brand-contrast !rounded-r-md",
  range_middle: "!bg-brand-soft !text-brand-ink",
} as const;

const triggerClass = cn(
  "inline-flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text",
  "outline-none transition-[border-color] duration-[120ms] focus-visible:ring-1 focus-visible:ring-brand-ink focus-visible:border-brand-ink",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-3" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

const popoverContentClass = "anim-pop z-[120] rounded-md border border-border bg-surface p-2 shadow-md";

export interface DatePickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function DatePicker({ value, onChange, placeholder = "Pick a date", label, disabled, id }: DatePickerProps) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={fieldId} className="text-xs font-semibold text-text-2">
          {label}
        </label>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger id={fieldId} disabled={disabled} className={triggerClass}>
          <span className={value ? "text-text" : "text-text-3"}>{value ? formatHuman(value) : placeholder}</span>
          <CalendarIcon />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} className={popoverContentClass}>
            <DayPicker
              mode="single"
              selected={isoToDate(value)}
              onSelect={(d) => {
                onChange(d ? dateToIso(d) : null);
                setOpen(false);
              }}
              classNames={dayPickerClassNames}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
