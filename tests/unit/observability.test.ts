import { describe, it, expect, vi, beforeEach } from "vitest";
import { logError } from "@/lib/observability";
import { jsonServerError } from "@/lib/http";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";

// ADR-0032: Sentry is the error transport behind logError. Server-only, activated
// solely by SENTRY_DSN, and it must never be able to break a request.
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

const captureMessage = vi.mocked(Sentry.captureMessage);
// SENTRY_DSN is the activation switch — flip it per test rather than the whole module.
const setDsn = (dsn: string | undefined) => {
  (env as { SENTRY_DSN?: string }).SENTRY_DSN = dsn;
};

beforeEach(() => {
  captureMessage.mockReset();
  setDsn(undefined);
});

// F-42: one request traceId correlates the error envelope with the server log line.
describe("F-42: logError traceId", () => {
  it("emits the traceId in the structured line when given", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("boom", { count: 2 }, "trace-123");
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "error", scope: "server", code: "boom", traceId: "trace-123", count: 2 });
    spy.mockRestore();
  });

  it("omits the traceId key entirely when none is given", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("boom");
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).not.toHaveProperty("traceId");
    spy.mockRestore();
  });

  it("never throws (best-effort), even on a circular detail", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logError("boom", circular, "t")).not.toThrow();
    spy.mockRestore();
  });
});

describe("ADR-0032: Sentry transport behind logError", () => {
  it("ADR-0032: sends nothing when SENTRY_DSN is unset (console-only, today's behavior)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("boom", { count: 2 }, "trace-123");
    expect(captureMessage).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("ADR-0032: sends the code, traceId and detail to Sentry when SENTRY_DSN is set", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn("https://key@o1.ingest.sentry.io/1");
    logError("cron_drain_tenant_failed", { tenantId: "t-1" }, "trace-123");
    expect(captureMessage).toHaveBeenCalledWith("cron_drain_tenant_failed", {
      level: "error",
      tags: { traceId: "trace-123" },
      extra: { tenantId: "t-1" },
    });
    spy.mockRestore();
  });

  it("ADR-0032: omits the traceId tag entirely when none is given", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn("https://key@o1.ingest.sentry.io/1");
    logError("boom");
    expect(captureMessage).toHaveBeenCalledWith("boom", { level: "error", extra: {} });
    spy.mockRestore();
  });

  it("ADR-0032: never throws when the Sentry send itself throws (best-effort contract)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn("https://key@o1.ingest.sentry.io/1");
    captureMessage.mockImplementation(() => {
      throw new Error("sentry transport is down");
    });
    expect(() => logError("boom", { count: 1 }, "t")).not.toThrow();
    spy.mockRestore();
  });

  it("ADR-0032: still emits the structured console line when Sentry is active", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn("https://key@o1.ingest.sentry.io/1");
    logError("boom", { count: 2 }, "trace-123");
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "error", code: "boom", traceId: "trace-123", count: 2 });
    spy.mockRestore();
  });

  it("ADR-0032: a console failure does not suppress the Sentry send", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn("https://key@o1.ingest.sentry.io/1");
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify throws — the console line is lost
    expect(() => logError("boom", circular, "t")).not.toThrow();
    expect(captureMessage).toHaveBeenCalled(); // ...but the error still reaches Sentry
    spy.mockRestore();
  });
});

describe("F-42: jsonServerError correlation", () => {
  it("returns a 500 whose envelope traceId matches the logged line's traceId", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = jsonServerError("lead_edit_failed", "Edit failed.", { message: "boom detail" });
    expect(res.status).toBe(500);
    const body = await res.json();
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(body.code).toBe("lead_edit_failed");
    expect(typeof body.traceId).toBe("string");
    expect(line.traceId).toBe(body.traceId); // same id on both surfaces
    spy.mockRestore();
  });
});
