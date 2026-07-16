import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";

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
// SEC-05: callers MUST NOT pass secrets — no passwords, tokens, OTP/reset codes,
// or seller PII in `detail`. Pass identifiers, error messages, IPs, counts only.
// ADR-0032 leans on that contract: whatever reaches `detail` reaches Sentry, so
// this seam is the boundary that keeps consumer PII out of a third party.
//
// F-42: pass the request's `traceId` so the log line correlates 1:1 with the
// `{code, message, traceId}` error envelope the caller returned for the same request
// (see http.ts jsonServerError). Sentry tags the event with the same id.
//
// ADR-0032: Sentry is the real transport, wired behind this seam — server-only, and
// activated solely by SENTRY_DSN. Unset (dev/test/CI) ⇒ console-only, as before.
export function logError(code: string, detail: Record<string, unknown> = {}, traceId?: string): void {
  try {
    console.error(
      JSON.stringify({ level: "error", scope: "server", code, ...(traceId ? { traceId } : {}), ...detail }),
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
        extra: detail,
      });
    }
  } catch {
    // Transport must never break a request.
  }
}
