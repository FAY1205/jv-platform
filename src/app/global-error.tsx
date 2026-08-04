"use client";

import "./globals.css";

// Root error boundary (F-67). Unlike error.tsx this replaces the ROOT layout, so it
// renders its own <html>/<body> and cannot depend on Providers/components. Kept token-
// styled and minimal; `error.digest` is the server-correlated trace id.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="font-display text-2xl font-semibold text-text">Something went wrong</h1>
          <p className="text-sm text-text-2">
            The application hit an unexpected error. Please try again.
          </p>
          {error.digest && (
            <p className="num rounded-md bg-surface-2 px-3 py-1.5 text-xs text-text-3">Reference: {error.digest}</p>
          )}
          <button
            onClick={reset}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-contrast transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
