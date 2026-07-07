import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Field-level error text (FRM-01: specific, placed at the field). */
  error?: string;
  /** Helper text shown when there is no error. */
  hint?: string;
}

/**
 * Input — labeled text field. Labels are top-aligned (DSN-09) and programmatically
 * bound (FRM-04). Error text is specific and placed at the field (FRM-01).
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className, ...rest },
  ref,
) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-text-2">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-md border bg-surface px-3 py-2 text-sm text-text",
          "placeholder:text-text-3 transition-[border-color] duration-[120ms]",
          "focus:outline-none focus-visible:outline-none",
          error
            ? "border-danger focus:border-danger"
            : "border-border focus:border-brand",
          className,
        )}
        {...rest}
      />
      {error ? (
        <span id={`${inputId}-error`} className="text-xs text-danger">
          {error}
        </span>
      ) : hint ? (
        <span id={`${inputId}-hint`} className="text-xs text-text-3">
          {hint}
        </span>
      ) : null}
    </div>
  );
});
