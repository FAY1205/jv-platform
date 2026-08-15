"use client";

import { dueChipFor, type DueChipTone } from "@/lib/task-due-chip";
import { cn } from "@/lib/cn";

// The task due/overdue/done chip shared by the per-lead TasksPanel and the My Tasks list
// (WP-TSK-4/5). One definition so the two views cannot drift in tone, wording, or padding.
//
// Design F-3: the mockup's chips are plain sans text — only the date fragment (if any)
// renders tabular/mono, so the "Overdue · " / "Done · " prefixes stay plain.
// PRN-14: tone is never the only signal — the label always names the state in words.

const TONE_CLASS: Record<DueChipTone, string> = {
  danger: "border-danger/45 bg-danger-soft text-danger",
  warn: "border-warn/45 bg-warn-soft text-warn",
  neutral: "border-border bg-surface text-text-2",
};

export interface DueChipProps {
  dueOn: string | null;
  doneAt: string | null;
  /** Injected "today" (TSK-10 discipline) — never read from the clock in here. */
  today: string;
  /** Extra classes for the host's layout only (My Tasks pins `shrink-0` in its flex row). */
  className?: string;
}

export function DueChip({ dueOn, doneAt, today, className }: DueChipProps) {
  const chip = dueChipFor(dueOn, doneAt, today);
  const prefix = chip.dateText ? chip.label.slice(0, chip.label.length - chip.dateText.length) : chip.label;
  return (
    <span
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONE_CLASS[chip.tone],
        className,
      )}
    >
      {prefix}
      {chip.dateText && <span className="num">{chip.dateText}</span>}
    </span>
  );
}
