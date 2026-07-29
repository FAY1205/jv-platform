// Client IP for rate-limit keying (AUT-03). This value bounds abuse protection on every
// auth endpoint, and on public signup it is one of only two limits (the other being
// Turnstile) — so which header we trust, and how we read it, are security decisions.
//
// Trust order, most trustworthy first:
//  1. `x-vercel-forwarded-for` — set by Vercel's own edge. Vercel already overwrites
//     `x-forwarded-for` to prevent client spoofing, but a reverse proxy placed IN FRONT of
//     Vercel can overwrite that one; the platform header survives it. (Vercel docs:
//     "identical to x-forwarded-for, however x-forwarded-for could be overwritten if you
//     are using a proxy on top of Vercel".)
//  2. `x-real-ip` — single-valued, set by the proxy (Vercel sets it; nginx convention).
//  3. `x-forwarded-for` — last resort for local dev and non-Vercel hosts.
//
// Which END of the chain we read differs by trust, and that difference is the point:
//  - Platform headers: take the LAST entry. `Headers.get()` merges duplicate headers with
//    ", ", and a client-sent copy arrives BEFORE the edge's own. Reading leftmost would let
//    a spoofed duplicate outrank the trusted value — which would make this file's whole
//    premise backwards. Last-entry is identical when the edge replaces the header and safe
//    when it merges, so it does not depend on undocumented platform behaviour.
//  - `x-forwarded-for` fallback: take the FIRST entry, the conventional client position.
//    On a host that appends rather than overwrites, that entry is client-controlled and
//    therefore untrusted — which is exactly why it ranks last.
//
// Null when unknown (local dev) or unparseable: IP-based limits then no-op and the
// per-identifier limits still apply, so a bad value degrades coverage rather than opening
// the endpoint — and never becomes a garbage key.
const PLATFORM_IP_HEADERS = ["x-vercel-forwarded-for", "x-real-ip"] as const;

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:]+$/;
const MAX_IP_LENGTH = 45; // longest textual IPv6

/**
 * Reduce a raw header entry to a stable rate-limit key, or null if it is not an IP.
 * The DB column is unbounded `text` behind a btree index and matching is exact string
 * equality, so an unvalidated value can either break the INSERT or silently fragment the
 * bucket — both of which fail OPEN.
 */
function normalizeIp(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (value.startsWith("[")) {
    // Bracketed IPv6 with a port: [2001:db8::1]:443
    const close = value.indexOf("]");
    value = close > 0 ? value.slice(1, close) : value.slice(1);
  } else if ((value.match(/:/g)?.length ?? 0) === 1) {
    value = value.split(":")[0]!; // IPv4 with a port: 1.2.3.4:5678
  }
  if (value.length === 0 || value.length > MAX_IP_LENGTH) return null;
  if (IPV4_RE.test(value)) return value;
  if (!IPV6_RE.test(value)) return null;
  // Bucket IPv6 on its /64: one ordinary allocation holds 2^64 addresses, so per-address
  // keying is free to evade and is not an abuse bound at all.
  const groups: string[] = [];
  for (const group of value.split(":")) {
    if (group === "" || groups.length === 4) break; // "" marks the "::" run
    groups.push(group);
  }
  return `${groups.join(":")}::`;
}

export function clientIp(request: Request): string | null {
  for (const header of PLATFORM_IP_HEADERS) {
    const entries = (request.headers.get(header) ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    const trusted = entries.at(-1); // the edge's own value, never a client-prepended copy
    if (trusted) return normalizeIp(trusted);
  }
  const first = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .find(Boolean);
  return first ? normalizeIp(first) : null;
}
