import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyTurnstile } from "@/lib/auth/turnstile";

afterEach(() => vi.unstubAllGlobals());

describe("ADR-0034: Turnstile verification (fail closed)", () => {
  it("returns false when the token is missing without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyTurnstile(undefined, "secret")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns true only when siteverify reports success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
    expect(await verifyTurnstile("tok", "secret")).toBe(true);
  });

  it("returns false on success:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: false }) })));
    expect(await verifyTurnstile("tok", "secret")).toBe(false);
  });

  it("returns false (fail closed) on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await verifyTurnstile("tok", "secret")).toBe(false);
  });
});
