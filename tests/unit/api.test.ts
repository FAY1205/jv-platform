// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiGet, ApiError } from "@/lib/api";

afterEach(() => vi.restoreAllMocks());

function stubFetch(body: string, init: ResponseInit) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, init)));
}

// UXQ-01: the server stamps a traceId on every error envelope. apiGet must not discard it
// (apiMutate already carries it) — otherwise no query-error state can satisfy UXQ-01.
describe("UXQ-01 / FEP-09: apiGet error envelope", () => {
  it("APIGET-01: throws an ApiError carrying the server's code, message, and traceId on a non-2xx", async () => {
    stubFetch(
      JSON.stringify({ code: "db_down", message: "The database is unavailable.", traceId: "trace-123" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
    const err = await apiGet("/api/whatever").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("The database is unavailable.");
    expect((err as ApiError).code).toBe("db_down");
    expect((err as ApiError).traceId).toBe("trace-123");
    expect((err as ApiError).status).toBe(500);
  });

  it("APIGET-02: resolves the JSON body unchanged on a 2xx", async () => {
    stubFetch(JSON.stringify({ ok: true, n: 3 }), { status: 200, headers: { "content-type": "application/json" } });
    await expect(apiGet<{ ok: boolean; n: number }>("/api/whatever")).resolves.toEqual({ ok: true, n: 3 });
  });

  it("APIGET-03: falls back to a status message (no traceId) when the error body is not JSON", async () => {
    stubFetch("gateway timeout", { status: 504 });
    const err = await apiGet("/api/whatever").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(504);
    expect((err as ApiError).traceId).toBeUndefined();
    expect((err as ApiError).message).toContain("504");
  });
});
