import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";
import { scrubDetail } from "@/lib/scrub";

// ADR-0032: this module pulls the Sentry SDK in, so importing it from client code would
// bundle Sentry into the browser — the consumer-PII leak ADR-0031 exists to prevent.
// `logError` reads like a generic helper, so that mistake is easy to make; fail loudly
// and immediately rather than ship a browser bundle that quietly phones a third party.
// (Dependency-free on purpose: the `server-only` package would need its own ADR.)
if (typeof window !== "undefined") {
  throw new Error("ADR-0032: @/lib/observability is server-only — never import it from client code.");
}

// Structured error-log seam and the single error chokepoint. Best-effort by
// construction: it MUST NOT throw and MUST NOT change control flow.
//
// SEC-05: callers SHOULD still pass identifiers, messages and counts — never secrets —
// but that contract is no longer what enforces it. `detail` is redacted (WP-SU-3) before
// it reaches EITHER sink, because 29 of 40 call sites pass `{ message: e.message }`, a
// string we do not author: Drizzle embeds every bound parameter of a failed query, and
// providers echo recipient addresses. Both sinks are third-party stores — Sentry, and the
// hosting provider's log retention — so "excluded from logs" (SEC-05) means both.
//
// F-42: pass the request's `traceId` so the log line correlates 1:1 with the
// `{code, message, traceId}` error envelope the caller returned for the same request
// (see http.ts jsonServerError). Sentry tags the event with the same id.
//
// ADR-0032: Sentry is the real transport, wired behind this seam — server-only, and
// activated solely by SENTRY_DSN. Unset (dev/test/CI) ⇒ console-only, as before.
export function logError(code: string, detail: Record<string, unknown> = {}, traceId?: string): void {
  // Scrub ONCE, use at both sinks: the console line is not a private channel (the host
  // retains it) and Sentry's default console integration would re-ship it as a breadcrumb
  // on the very event whose `extra` we redact — so an unscrubbed line here would defeat
  // the redaction entirely.
  // Its own try: scrubDetail catches internally, but logError's never-throws contract must
  // not depend on another module's internals staying that way.
  let safe: Record<string, unknown>;
  try {
    safe = scrubDetail(detail);
  } catch {
    safe = { scrub_failed: true };
  }
  try {
    console.error(
      // `safe` FIRST: a caller detail key named `code`/`level`/`traceId` would otherwise
      // overwrite the envelope and break the F-42 1:1 correlation this seam exists for.
      JSON.stringify({ ...safe, level: "error", scope: "server", code, ...(traceId ? { traceId } : {}) }),
    );
  } catch {
    // Logging must never break a request.
  }
  // Its own try: a console failure (e.g. a circular `detail`) must not cost us the
  // Sentry event, and a Sentry failure must not cost us anything at all.
  try {
    if (env.SENTRY_DSN) {
      Sentry.captureMessage(code, {
        level: "error",
        ...(traceId ? { tags: { traceId } } : {}),
        extra: safe,
      });
    }
  } catch {
    // Transport must never break a request.
  }
}
