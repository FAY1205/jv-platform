import * as React from "react";
import { cn } from "@/lib/cn";
import { FieldLabel } from "./FieldLabel";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  /** Field-level error text (FRM-01: specific, placed at the field). */
  error?: string;
  /** Helper text shown when there is no error. */
  hint?: string;
  /** Muted "(optional)" tag; `required` renders the red asterisk (#27). */
  optional?: boolean;
}

/**
 * Textarea — labeled multi-line field. Labels are top-aligned (DSN-09) and
 * programmatically bound (FRM-04); error text is specific and placed at the field
 * (FRM-01). States: default / focus-visible / disabled.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, id, className, rows = 3, optional, required, ...rest },
  ref,
) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <FieldLabel htmlFor={fieldId} required={required} optional={optional}>
          {label}
        </FieldLabel>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full resize-y rounded-md border bg-surface px-3 py-2 text-sm text-text",
          "placeholder:text-text-3 transition-[border-color] duration-[120ms]",
          // Single focus treatment (brand border + flush same-color ring); outline-none opts
          // out of the global :focus-visible outline so it doesn't stack (see globals.css).
          "outline-none focus-visible:ring-1 focus-visible:ring-brand-ink",
          "disabled:cursor-not-allowed disabled:opacity-60",
          error ? "border-danger focus:border-danger" : "border-border-soft focus:border-brand-ink",
          className,
        )}
        {...rest}
      />
      {error ? (
        <span id={`${fieldId}-error`} className="text-xs text-danger">
          {error}
        </span>
      ) : hint ? (
        <span id={`${fieldId}-hint`} className="text-xs text-text-3">
          {hint}
        </span>
      ) : null}
    </div>
  );
});
