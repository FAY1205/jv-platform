"use client";

import * as React from "react";
import { Select } from "./Select";
import { cn } from "@/lib/cn";

// Pagination — the shared page controls + rows-per-page selector (FEP-03). Controlled:
// the page owns `page`/`pageSize`/`total` and reacts to the callbacks. Rows-per-page is
// whitelisted to {10,20,50}, default 20 (the server pageSize param mirrors this list).

export const PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  className?: string;
}

/**
 * The square arrow-button recipe: 32px (comfortably past the WCAG 2.5.8 24px floor on every
 * pointer), hairline border, brand-ink focus ring, and a real `disabled` treatment for the
 * data boundaries at the ends of a range. Exported because the N5-04 lead pager is the second
 * user (FRONTEND_STANDARDS §2 — the second copy becomes the shared recipe); both consumers
 * render a plain `<button>`, so this is a class string rather than a component.
 */
export const ARROW_BUTTON_CLASS = cn(
  "grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-text-2 outline-none transition-colors",
  "hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-brand-ink",
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface",
);

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-4", className)}>
      <div className="flex items-center gap-2 text-sm text-text-2">
        <span>Rows</span>
        <div className="w-[4.5rem]">
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v))}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            ariaLabel="Rows per page"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="num text-sm text-text-3">
          {first}–{last} of {total}
        </span>
        <div className="flex items-center gap-1.5">
          <button type="button" className={ARROW_BUTTON_CLASS} onClick={() => onPageChange(current - 1)} disabled={current <= 1} aria-label="Previous page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span className="num text-sm text-text-2">
            {current} / {totalPages}
          </span>
          <button type="button" className={ARROW_BUTTON_CLASS} onClick={() => onPageChange(current + 1)} disabled={current >= totalPages} aria-label="Next page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
