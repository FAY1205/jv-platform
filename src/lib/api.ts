import type { ErrorEnvelope } from "@/lib/http";
import { csrfHeaders } from "@/lib/csrf-client";

/** A client fetch/write error carrying the server envelope's code + traceId (FEP-09).
 *  Both `apiGet` and `apiMutate` throw this so error states can surface the traceId (UXQ-01). */
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
 * Client-side read helper: on a non-2xx throws an `ApiError` carrying the uniform
 * `{ code, message, traceId }` envelope (UXQ-01) — same shape `apiMutate` throws, so a
 * shared `<QueryErrorState>` can render the message, the trace id, and a Retry action.
 */
export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new ApiError(body?.message ?? `Request failed (${res.status})`, body?.code, body?.traceId, res.status);
  }
  return res.json() as Promise<T>;
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

/** `filename="…"` out of a Content-Disposition, else null. The SERVER names the file (it is
 *  the one that knows the date the export was taken); this only reads what it said. */
function filenameFrom(disposition: string | null): string | null {
  const match = /filename="([^"]+)"/.exec(disposition ?? "");
  return match ? match[1] : null;
}

/**
 * A POST whose success is a FILE rather than JSON (WP-N6 export-selected). Same CSRF header
 * and same `ApiError` envelope handling as `apiMutate` — the failure path is the one that
 * matters, since an export that 403s must reach the operator as the server's sentence, not as
 * a browser downloading an error page.
 *
 * The blob is handed to a synthetic anchor: a POST cannot be a plain `<a href>`, and this is
 * the only shape that lets the response body reach the disk without a second round trip
 * through Storage (N6-43: nothing is stored).
 */
export async function apiDownload(url: string, body: unknown, fallbackName: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const envelope = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new ApiError(envelope?.message ?? `Request failed (${res.status})`, envelope?.code, envelope?.traceId, res.status);
  }
  const href = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement("a");
    a.href = href;
    a.download = filenameFrom(res.headers.get("content-disposition")) ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoked on the NEXT task, not synchronously. `click()` returns before the browser has
    // finished handing the blob to its download manager, and on a large workbook revoking in
    // the same tick is the documented cross-browser race that truncates or cancels the file.
    // A macrotask is late enough for every engine and still bounded — leaving it un-revoked
    // would pin the whole workbook in memory for the tab's lifetime.
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }
}
