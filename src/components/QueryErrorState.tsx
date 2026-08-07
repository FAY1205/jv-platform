import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

/** The server envelope's traceId, if the error carries one (every `ApiError` from
 *  `@/lib/api` does). Duck-typed so this presentational component stays decoupled from
 *  the fetch layer — no `instanceof` import of the client `api` module. */
function traceIdOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "traceId" in error) {
    const t = (error as { traceId?: unknown }).traceId;
    if (typeof t === "string" && t) return t;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Something went wrong. Please try again.";
}

export interface QueryErrorStateProps {
  /** The query error (typically an `ApiError` carrying the server's `{ code, message, traceId }`). */
  error: unknown;
  /** Site-specific headline, e.g. "Couldn't load partners". */
  title?: string;
  /** Overrides the message derived from `error` — e.g. detail dialogs' "Not found." fallback
   *  for the `!data` case where there is no Error object but the entity is simply missing. */
  description?: string;
  /** Renders a Retry button that calls this — pass `() => query.refetch()`. Omit when the
   *  query cannot be refetched from here. */
  onRetry?: () => void;
  /** Compact inline/embedded status — fills its container (a panel or a card slot) rather
   *  than a full-page state. Mirrors `EmptyState`'s compact variant. */
  compact?: boolean;
  className?: string;
}

/**
 * QueryErrorState — the one error state for a failed async data fetch (UXQ-01a / DSN-06).
 * Renders the headline, the server message, a mono `Reference: <traceId>` line (so a user
 * has something to report and support can correlate — mirrors `error.tsx`'s crash boundary),
 * and a Retry action where the query is refetchable. `role="status"` because it replaces
 * loaded/expected content after an async settle (D2, SC 4.1.3), matching `EmptyState`.
 */
export function QueryErrorState({ error, title = "Couldn't load this", description, onRetry, compact, className }: QueryErrorStateProps) {
  const message = description ?? messageOf(error);
  const traceId = traceIdOf(error);

  if (compact) {
    return (
      <div role="status" className={cn("grid h-full place-items-center gap-1.5 px-4 py-6 text-center", className)}>
        <p className="text-sm text-text-3">{title}</p>
        {traceId && <p className="num text-step-0 text-text-3">Reference: {traceId}</p>}
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div role="status" className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      <div className="mb-1 grid h-10 w-10 place-items-center rounded-full bg-danger-soft text-danger">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      </div>
      <div className="font-semibold">{title}</div>
      <p className="max-w-sm text-sm text-text-3">{message}</p>
      {traceId && (
        <p className="num rounded-md bg-surface-2 px-3 py-1.5 text-step-0 text-text-3">Reference: {traceId}</p>
      )}
      {onRetry && (
        <div className="mt-2">
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
