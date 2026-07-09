import type { ErrorEnvelope } from "@/lib/http";
import { csrfHeaders } from "@/lib/csrf-client";

// Client-side fetch helper: throws the API's { code, message, traceId } message on error.
export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** A client write error carrying the server envelope's code + traceId (FEP-09). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly traceId: string | undefined,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The single client mutation helper (FEP-09 / F-82): attaches the CSRF header and
 * the JSON content type, sends `body` as JSON, and on a non-2xx throws an `ApiError`
 * carrying the uniform `{ code, message, traceId }` envelope. Every client write
 * migrates onto this (per-page, WS-2+) so error handling + CSRF are never hand-rolled.
 */
export async function apiMutate<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as (ErrorEnvelope & Record<string, unknown>) | null;
  if (!res.ok) {
    throw new ApiError(json?.message ?? `Request failed (${res.status})`, json?.code, json?.traceId, res.status);
  }
  return json as T;
}
