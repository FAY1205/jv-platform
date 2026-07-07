import { NextResponse } from "next/server";

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

export function jsonError(code: string, message: string, status = 400): NextResponse {
  const body: ErrorEnvelope = { code, message, traceId: newTraceId() };
  return NextResponse.json(body, { status });
}
