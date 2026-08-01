import * as React from "react";
import { cn } from "@/lib/cn";
import type { SelectOption } from "./Select";

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options?: SelectOption[];
}

/**
 * NativeSelect — the original event-based native `<select>` (label/error/hint/options).
 * Retained for un-migrated pages; the Radix `Select` (controlled API) is preferred for
 * new/reworked pages. Both are removed-of-the-native at WS-8 once every page has moved.
 */
export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(function NativeSelect(
  { label, error, hint, options, id, className, children, ...rest },
  ref,
) {
  const autoId = React.useId();
  const selectId = id ?? autoId;
  const describedBy = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-xs font-semibold text-text-2">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full appearance-none rounded-md border bg-surface px-3 py-2 pr-9 text-sm font-medium text-text-2",
            // Single focus treatment; outline-none opts out of the global outline (globals.css).
            "transition-[border-color] duration-[120ms] outline-none focus-visible:ring-1 focus-visible:ring-brand-ink",
            error ? "border-danger focus:border-danger" : "border-border-soft focus:border-brand-ink",
            className,
          )}
          {...rest}
        >
          {options
            ? options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))
            : children}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-3"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
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
});
