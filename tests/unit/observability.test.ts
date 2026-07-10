import { describe, it, expect, vi } from "vitest";
import { logError } from "@/lib/observability";
import { jsonServerError } from "@/lib/http";

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
