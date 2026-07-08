// Minimal structured error-log seam — a precursor to full observability (ACT-03,
// Sentry). Best-effort by construction: it MUST NOT throw and MUST NOT change
// control flow. Wire real transport (Sentry) in behind this later.
//
// SEC-05: callers MUST NOT pass secrets — no passwords, tokens, OTP/reset codes,
// or seller PII in `detail`. Pass identifiers, error messages, IPs, counts only.
export function logError(code: string, detail: Record<string, unknown> = {}): void {
  try {
    console.error(JSON.stringify({ level: "error", scope: "server", code, ...detail }));
  } catch {
    // Logging must never break a request.
  }
}
