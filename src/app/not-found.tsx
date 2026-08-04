import Link from "next/link";

// Global 404 (F-67 / UXQ-09): a styled, actionable dead-end rather than Next's
// unstyled default. Server component — no client state needed.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="num text-sm font-semibold text-text-3">404</p>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold text-text">Page not found</h1>
        <p className="text-sm text-text-2">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-contrast transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
      >
        Go home
      </Link>
    </main>
  );
}
