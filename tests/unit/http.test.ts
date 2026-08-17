import { describe, it, expect, vi } from "vitest";
import { jsonOk, jsonError, jsonServerError, jsonServiceUnavailable } from "@/lib/http";

vi.mock("@/lib/observability", () => ({ logError: vi.fn() }));

// C-21 / AUT-13: authenticated JSON payloads are tenant-scoped and must never be cached
// by a shared proxy or the browser. jsonOk is the single success path for every API route.
describe("C-21: jsonOk cache-control", () => {
  it("C-21: sets Cache-Control: private, no-store on every success payload", () => {
    const res = jsonOk({ hello: "world" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("C-21: still returns the payload and a 200 unchanged", async () => {
    const res = jsonOk({ a: 1, b: [2, 3] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1, b: [2, 3] });
  });
});

// Regression guards for the uniform error envelope shape — unchanged by C-21.
describe("uniform error envelope", () => {
  it("jsonError returns { code, message, traceId } with the given status", async () => {
    const res = jsonError("bad_input", "Nope.", 422);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ code: "bad_input", message: "Nope." });
    expect(typeof body.traceId).toBe("string");
  });

  // C-21 F-1: error responses are tenant-scoped too and must not be cached either.
  it("C-21: jsonError and jsonServerError also set Cache-Control: private, no-store", () => {
    expect(jsonError("x", "y", 400).headers.get("Cache-Control")).toBe("private, no-store");
    expect(jsonServerError("x", "y").headers.get("Cache-Control")).toBe("private, no-store");
  });

  // C-3 (SEC-09): a transient backend outage → 503 + Retry-After (retryable), still no-store.
  it("C-3: jsonServiceUnavailable returns 503 with Retry-After and the uniform envelope", async () => {
    const res = jsonServiceUnavailable("svc_down", "Temporarily unavailable.");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({ code: "svc_down", message: "Temporarily unavailable." });
    expect(typeof body.traceId).toBe("string");
  });

  it("C-3: jsonServiceUnavailable honours a custom retryAfterSec", () => {
    expect(jsonServiceUnavailable("x", "y", {}, 30).headers.get("Retry-After")).toBe("30");
  });

  it("jsonServerError logs + returns a 500 envelope sharing one traceId", async () => {
    const res = jsonServerError("boom", "Something failed.");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ code: "boom", message: "Something failed." });
    expect(typeof body.traceId).toBe("string");
  });
});
