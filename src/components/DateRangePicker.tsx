"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/lib/cn";
import { isoToDate, dateToIso, dayPickerClassNames } from "./DatePicker";

// DateRangePicker — a Radix Popover trigger + react-day-picker range calendar
// (ADR-0016). Emits `{ from, to }` as ISO `yyyy-mm-dd` strings (or null). WS-2 supplies
// the preset chips (Last 7/30/12mo/All); this primitive owns the calendar + range only.

export interface DateRangeValue {
  from: string | null;
  to: string | null;
}

export interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  id?: string;
}

function fmt(iso: string | null): string {
  const d = isoToDate(iso);
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

const triggerClass = cn(
  "inline-flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text",
  "outline-none transition-[border-color] duration-[120ms] focus-visible:ring-1 focus-visible:ring-brand-ink focus-visible:border-brand-ink",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export function DateRangePicker({ value, onChange, placeholder = "Pick a range", label, disabled, id }: DateRangePickerProps) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const [open, setOpen] = React.useState(false);

  const selected: DateRange | undefined = value.from
    ? { from: isoToDate(value.from), to: isoToDate(value.to) }
    : undefined;
  const summary = value.from ? `${fmt(value.from)}${value.to ? ` – ${fmt(value.to)}` : ""}` : "";

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={fieldId} className="text-xs font-semibold text-text-2">
          {label}
        </label>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger id={fieldId} disabled={disabled} className={triggerClass}>
          <span className={value.from ? "text-text" : "text-text-3"}>{value.from ? summary : placeholder}</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-3" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} className="anim-pop z-[120] rounded-md border border-border bg-surface p-2 shadow-md">
            <DayPicker
              mode="range"
              selected={selected}
              onSelect={(range) => onChange({ from: range?.from ? dateToIso(range.from) : null, to: range?.to ? dateToIso(range.to) : null })}
              classNames={dayPickerClassNames}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
