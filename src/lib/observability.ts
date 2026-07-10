// Minimal structured error-log seam — a precursor to full observability (ACT-03,
// Sentry). Best-effort by construction: it MUST NOT throw and MUST NOT change
// control flow. Wire real transport (Sentry) in behind this later.
//
// SEC-05: callers MUST NOT pass secrets — no passwords, tokens, OTP/reset codes,
// or seller PII in `detail`. Pass identifiers, error messages, IPs, counts only.
//
// F-42: pass the request's `traceId` so the log line correlates 1:1 with the
// `{code, message, traceId}` error envelope the caller returned for the same request
// (see http.ts jsonServerError). When Sentry is wired (ADR-0021) it consumes the
// same structured, PII-free context + traceId.
export function logError(code: string, detail: Record<string, unknown> = {}, traceId?: string): void {
  try {
    console.error(
      JSON.stringify({ level: "error", scope: "server", code, ...(traceId ? { traceId } : {}), ...detail }),
    );
  } catch {
    // Logging must never break a request.
  }
}
