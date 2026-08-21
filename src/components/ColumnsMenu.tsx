"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuItem,
} from "./DropdownMenu";

// A show/hide-columns control for a data table (the admin leads list). The column vocabulary
// and which columns are PINNED live with the table; this component only renders the roster and
// reports toggles upward. Persistence is the caller's job (a UI preference — PRN-15). Pinned
// columns render checked + disabled so the full roster is always visible (no invisible-column
// mystery) and the table can never be emptied.

export interface ColumnDef {
  id: string;
  label: string;
  /** Always shown, not user-hideable (rendered checked + disabled, labelled "pinned"). */
  pinned?: boolean;
}

const ColumnsIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16v16H4zM10 4v16M16 4v16" />
  </svg>
);

export interface ColumnsMenuProps {
  columns: readonly ColumnDef[];
  /** The ids the user has hidden (pinned ids here are ignored). */
  hidden: readonly string[];
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
  className?: string;
  /**
   * N6-73: optional CONTROLLED open state, so a caller outside this component can raise the
   * menu — the Ctrl-K palette's "Open Columns" action reaches the leads page by event, and the
   * page has to be able to act on it. Omit both props (the default) and the menu stays
   * uncontrolled exactly as before: Radix treats `open === undefined` as uncontrolled, so
   * there is no second code path to keep in step.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ColumnsMenu({ columns, hidden, onToggle, onReset, className, open, onOpenChange }: ColumnsMenuProps) {
  const hiddenCount = columns.filter((c) => !c.pinned && hidden.includes(c.id)).length;
  const atDefault = hiddenCount === 0;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Choose columns"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-text-2 outline-none transition-colors",
            "hover:bg-surface-2 hover:text-text focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.98]",
            "data-[state=open]:bg-surface-2",
            className,
          )}
        >
          <ColumnsIcon />
          Columns
          {/* PRN-14: the deviation is stated in words, never by a colored dot alone. */}
          {hiddenCount > 0 && <span className="font-normal text-text-3">· {hiddenCount} hidden</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        {columns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={c.pinned ? true : !hidden.includes(c.id)}
            disabled={c.pinned}
            // Keep the menu open on toggle so several columns can be adjusted in one visit.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(v) => onToggle(c.id, v === true)}
          >
            <span className="flex-1 truncate">{c.label}</span>
            {c.pinned && <span className="shrink-0 text-step-0 text-text-3">pinned</span>}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={atDefault}
          onSelect={() => onReset()}
          className={cn("text-xs font-semibold", atDefault ? "text-text-3" : "text-brand-ink")}
        >
          Reset to default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
