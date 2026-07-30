import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";

// ADR-0032 / WP-SU-10: App Router route-handler errors never reached Sentry — instrumentation.ts
// exported only `register`, so an uncaught throw out of a route was invisible. Next calls the
// `onRequestError` hook for exactly those errors; this wires it to Sentry.captureRequestError.
vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  consoleIntegration: vi.fn(() => ({ name: "Console" })),
  httpIntegration: vi.fn(() => ({ name: "Http" })),
  captureRequestError: vi.fn(),
}));

const captureRequestError = vi.mocked(Sentry.captureRequestError);
const setDsn = (dsn: string | undefined) => {
  (env as { SENTRY_DSN?: string }).SENTRY_DSN = dsn;
};
const loadHook = async () => (await import("@/instrumentation")).onRequestError;

// A realistic Next 16 onRequestError payload (next/dist/server/instrumentation/types).
const REQ = { path: "/api/auth/reset/confirm", method: "POST", headers: { cookie: "__Host-x=secret" } };
const CTX = {
  routerKind: "App Router" as const,
  routePath: "/api/auth/reset/confirm",
  routeType: "route" as const,
  revalidateReason: undefined,
};

beforeEach(() => {
  captureRequestError.mockReset();
  setDsn(undefined);
});

describe("ADR-0032 (WP-SU-10): App Router handler errors reach Sentry", () => {
  it("ACT-03: forwards the error, request and context to Sentry when the DSN is set", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const err = new Error("boom");
    await (await loadHook())(err, REQ, CTX);
    expect(captureRequestError).toHaveBeenCalledTimes(1);
    expect(captureRequestError).toHaveBeenCalledWith(err, REQ, CTX);
  });

  it("SEC-07: stays inert when SENTRY_DSN is unset (dev/test/CI/preview)", async () => {
    await (await loadHook())(new Error("boom"), REQ, CTX);
    expect(captureRequestError).not.toHaveBeenCalled();
  });

  it("ADR-0032: never throws — a failing transport must not break error handling", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    captureRequestError.mockImplementation(() => {
      throw new Error("transport down");
    });
    const hook = await loadHook();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Synchronous, void-returning (Next's InstrumentationOnRequestError allows void); the internal
    // try/catch must swallow a transport failure so error handling is never broken.
    expect(() => hook(new Error("boom"), REQ, CTX)).not.toThrow();
    // ...but it must leave ONE first-party trace that the transport failed (pr-reviewer F-1),
    // carrying only the code — no PII.
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain("sentry_capture_request_error_failed");
    errSpy.mockRestore();
  });
});
