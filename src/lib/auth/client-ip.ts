// Best-effort client IP for rate-limit keying (AUT-03). Behind Vercel/proxies the
// real client is the first entry of x-forwarded-for. Null when unknown (local dev),
// in which case IP-based limits simply no-op and identifier limits still apply.
export function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  return real?.trim() || null;
}
