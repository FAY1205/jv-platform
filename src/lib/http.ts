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

export function jsonOk<T>(data: T): NextResponse {
  return NextResponse.json(data);
}

/** Uniform error envelope. `traceId` may be supplied so the envelope and a matching
 *  server log line share one id (F-42); it defaults to a fresh id. */
export function jsonError(code: string, message: string, status = 400, traceId: string = newTraceId()): NextResponse {
  const body: ErrorEnvelope = { code, message, traceId };
  return NextResponse.json(body, { status });
}

/** F-42: log a server error AND return its 500 envelope sharing ONE traceId, so a
 *  user-reported trace maps to the server log line. `detail` follows the SEC-05
 *  no-secrets/PII contract. Use this in a route's unexpected-error (500) catch. */
export function jsonServerError(code: string, message: string, detail: Record<string, unknown> = {}): NextResponse {
  const traceId = newTraceId();
  logError(code, detail, traceId);
  return jsonError(code, message, 500, traceId);
}
