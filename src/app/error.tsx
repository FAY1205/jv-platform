"use client";

import { Button } from "@/components";

// Route-segment error boundary (F-67 / UXQ-01). Next renders this on an uncaught
// render/data error in a segment; `error.digest` is the server-correlated trace id.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold text-text">Something went wrong</h1>
        <p className="text-sm text-text-2">
          An unexpected error interrupted this page. You can try again — if it keeps happening, share the
          reference below.
        </p>
      </div>
      {error.digest && (
        <p className="num rounded-md bg-surface-2 px-3 py-1.5 text-xs text-text-3">Reference: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Button variant="secondary" onClick={() => (window.location.href = "/")}>
          Go home
        </Button>
      </div>
    </main>
  );
}
