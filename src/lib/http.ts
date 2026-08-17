import { NextResponse } from "next/server";
import { logError } from "@/lib/observability";

// ─────────────────────────────────────────────────────────────────────────────
// Uniform API envelope (API standards). Every error is { code, message, traceId };
// success returns the payload directly. Inputs are Zod-validated at the boundary.
// ─────────────────────────────────────────────────────────────────────────────

export interface ErrorEnvelope {
  code: string;
  message: string;
  traceId: string;
}

export function newTraceId(): string {
  return globalThis.crypto.randomUUID();
}

// C-21 / AUT-13: every JSON API response is tenant-scoped (a success payload, or an error whose
// context could hint at another tenant's data), so none may be cached by a shared proxy or a
// browser (the back button revealing stale/foreign data). `jsonOk` and `jsonError` are the two
// exits every route takes, so setting the header on both reaches them ALL — independent of the
// front proxy's page-level `no-store` (src/proxy.ts), which only fires when a Supabase session
// resolves and so does not cover bearer/cron responses. No endpoint serves a deliberately-
// cacheable body (the only explicit Cache-Control values in the tree are already `no-store`:
// exports, templates), so a blanket header is safe. File downloads set their own headers via
// `new Response`, not these helpers.
const NO_STORE = "private, no-store";

export function jsonOk<T>(data: T): NextResponse {
  return NextResponse.json(data, { headers: { "Cache-Control": NO_STORE } });
}

/** Uniform error envelope. `traceId` may be supplied so the envelope and a matching
 *  server log line share one id (F-42); it defaults to a fresh id. */
export function jsonError(code: string, message: string, status = 400, traceId: string = newTraceId()): NextResponse {
  const body: ErrorEnvelope = { code, message, traceId };
  return NextResponse.json(body, { status, headers: { "Cache-Control": NO_STORE } });
}

/** F-42: log a server error AND return its 500 envelope sharing ONE traceId, so a
 *  user-reported trace maps to the server log line. `detail` follows the SEC-05
 *  no-secrets/PII contract. Use this in a route's unexpected-error (500) catch. */
export function jsonServerError(code: string, message: string, detail: Record<string, unknown> = {}): NextResponse {
  const traceId = newTraceId();
  logError(code, detail, traceId);
  return jsonError(code, message, 500, traceId);
}

/** C-3 (SEC-08 availability): a TRANSIENT backend outage — not the caller's fault and expected to
 *  recover — returns 503 + `Retry-After` so a client or uptime monitor backs off instead of treating
 *  it as a hard failure. Same log-with-shared-traceId contract as jsonServerError (SEC-05 detail).
 *  Use only where the fault is genuinely retryable AND account-independent (a 503 vs 500 must not
 *  become an account-existence oracle — see the login route's AUT-05 note). */
export function jsonServiceUnavailable(
  code: string,
  message: string,
  detail: Record<string, unknown> = {},
  retryAfterSec = 5,
): NextResponse {
  const traceId = newTraceId();
  logError(code, detail, traceId);
  const body: ErrorEnvelope = { code, message, traceId };
  return NextResponse.json(body, {
    status: 503,
    headers: { "Cache-Control": NO_STORE, "Retry-After": String(retryAfterSec) },
  });
}
