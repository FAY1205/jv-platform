import type { ErrorEnvelope } from "@/lib/http";

// Client-side fetch helper: throws the API's { code, message, traceId } message on error.
export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
