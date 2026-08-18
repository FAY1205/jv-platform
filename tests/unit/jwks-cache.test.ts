import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCachedJwks, __resetJwksCache } from "@/lib/supabase/jwks";

// WP-PERF-AUTH: the module-cached JWKS keeps getClaims network-free on the hot path. These pin
// the two behaviours that make it a win (fetch once, share across calls) and safe (never throw;
// serve the last good copy when a refresh fails).

const JWKS = { keys: [{ kid: "k1", kty: "EC", crv: "P-256" }] };

function okFetch(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => __resetJwksCache());
afterEach(() => vi.unstubAllGlobals());

describe("getCachedJwks", () => {
  it("fetches the JWKS once and serves the cache on subsequent calls within the TTL", async () => {
    const fetchSpy = okFetch(JWKS);
    vi.stubGlobal("fetch", fetchSpy);

    const a = await getCachedJwks();
    const b = await getCachedJwks();

    expect(a).toEqual(JWKS);
    expect(b).toEqual(JWKS);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // second call hit the cache, no network
    // It targets the project's well-known JWKS endpoint.
    expect(String((fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toMatch(/\/auth\/v1\/\.well-known\/jwks\.json$/);
  });

  it("concurrent cold callers share ONE in-flight fetch", async () => {
    const fetchSpy = okFetch(JWKS);
    vi.stubGlobal("fetch", fetchSpy);
    const [a, b] = await Promise.all([getCachedJwks(), getCachedJwks()]);
    expect(a).toEqual(JWKS);
    expect(b).toEqual(JWKS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws on a network failure — returns null when nothing is cached yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch);
    await expect(getCachedJwks()).resolves.toBeNull();
  });

  it("a non-ok / empty response yields null (getClaims then fetches it itself)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch);
    await expect(getCachedJwks()).resolves.toBeNull();
  });
});
