import { env } from "@/lib/env";

// WP-PERF-AUTH: a module-scoped JWKS cache for LOCAL JWT verification.
//
// `getServerScope` verifies the request's access token with `supabase.auth.getClaims()`
// against the project's asymmetric signing key (ECC/RSA) — no network round trip, unlike the
// old second `getUser()`. But getClaims caches the JWKS on the CLIENT instance, and we build a
// fresh Supabase server client per request, so its cache is always cold → it would fetch the
// JWKS from `/.well-known/jwks.json` on every request. Caching the key set here at module
// scope (shared across requests in a warm function) and handing it to getClaims keeps the hot
// path network-free.
//
// Key rotation self-heals: a `kid` this cache doesn't know still resolves — getClaims falls
// through to its own network fetch for a missing kid — and this cache refreshes on the next TTL
// tick. Never throws; a failed refresh keeps serving the last good copy (better a slightly-old
// public key set than none — a revoked key is caught by signature failure, not by JWKS absence).
// See docs/audit/2026-08-18-double-jwt-verify.md.

/** The minimal shape getClaims needs: a `keys` array of JWKs (each with a `kid`). */
export interface Jwks {
  keys: { kid?: string }[];
}

const JWKS_TTL_MS = 10 * 60_000; // a rotated key is picked up within 10 minutes

let cached: Jwks | null = null;
let cachedAt = 0;
let inflight: Promise<Jwks | null> | null = null;

function jwksUrl(): string | null {
  return env.SUPABASE_URL ? `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json` : null;
}

async function fetchJwks(): Promise<Jwks | null> {
  const url = jwksUrl();
  if (!url) return null;
  try {
    const res = await fetch(url, env.SUPABASE_ANON_KEY ? { headers: { apikey: env.SUPABASE_ANON_KEY } } : undefined);
    if (!res.ok) return null;
    const body = (await res.json()) as Jwks;
    return Array.isArray(body?.keys) && body.keys.length > 0 ? body : null;
  } catch {
    return null; // network/parse failure — caller falls back to the last good copy
  }
}

/**
 * The project's JWKS, cached at module scope with a TTL. Returns the stale copy if a refresh
 * fails, or null if it was never fetched (then getClaims fetches it itself). Concurrent callers
 * during a cold refresh share one in-flight fetch. Never throws.
 */
export async function getCachedJwks(): Promise<Jwks | null> {
  if (cached && Date.now() - cachedAt < JWKS_TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = fetchJwks().then((fresh) => {
    if (fresh) {
      cached = fresh;
      cachedAt = Date.now();
    }
    inflight = null;
    return fresh ?? cached; // fall back to the last good copy on failure
  });
  return inflight;
}

/** Test hook: clear the module cache between cases. */
export function __resetJwksCache(): void {
  cached = null;
  cachedAt = 0;
  inflight = null;
}
