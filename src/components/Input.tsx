import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Field-level error text (FRM-01: specific, placed at the field). */
  error?: string;
  /** Helper text shown when there is no error. */
  hint?: string;
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}

/**
 * Input — labeled text field. Labels are top-aligned (DSN-09) and programmatically
 * bound (FRM-04). Error text is specific and placed at the field (FRM-01). Password
 * fields get a built-in show/hide toggle (default/hover/focus-visible states).
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className, type = "text", ...rest },
  ref,
) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  const isPassword = type === "password";
  const [revealed, setRevealed] = React.useState(false);
  const effectiveType = isPassword && revealed ? "text" : type;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-text-2">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={effectiveType}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full rounded-md border bg-surface px-3 py-2 text-sm text-text",
            isPassword && "pr-10",
            "placeholder:text-text-3 transition-[border-color] duration-[120ms]",
            "focus:outline-none focus-visible:outline-none",
            error ? "border-danger focus:border-danger" : "border-border focus:border-brand",
            className,
          )}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            tabIndex={rest.disabled ? -1 : 0}
            className={cn(
              "absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded",
              "text-text-3 transition-colors hover:text-text-2",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            )}
          >
            <EyeIcon off={revealed} />
          </button>
        )}
      </div>
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
