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

// WP-SU-3 / SEC-05: `logError` forwards caller `detail` to Sentry, and 29 of the 40 call
// sites pass `{ message: e.message }` — a string we do NOT author. Postgres embeds the
// offending literal in constraint errors; providers echo the recipient address. So the
// no-PII guarantee cannot rest on caller discipline alone: scrub at the boundary.
describe("SEC-05: detail scrubbing before it reaches Sentry", () => {
  const DSN = "https://key@o1.ingest.sentry.io/1";
  // captureMessage's 2nd arg is a CaptureContext | SeverityLevel union; narrow to the
  // context shape these tests assert on.
  const sentryExtra = () =>
    (captureMessage.mock.calls[0][1] as { extra?: Record<string, unknown> }).extra ?? {};

  it("SEC-05: redacts an email address embedded in a driver/provider message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    logError("notify_failed", { message: 'duplicate key: "seller@example.com" rejected' });
    expect(sentryExtra().message).not.toContain("seller@example.com");
    expect(String(sentryExtra().message)).toContain("[redacted-email]");
    spy.mockRestore();
  });

  it("SEC-05: redacts a long token-shaped run (reset/verification tokens are 64 hex chars)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    const token = "a".repeat(64);
    logError("verify_failed", { message: `token ${token} expired` });
    expect(sentryExtra().message).not.toContain(token);
    expect(String(sentryExtra().message)).toContain("[redacted-token]");
    spy.mockRestore();
  });

  it("SEC-05: does NOT redact UUIDs — traceId/tenantId/userId must stay debuggable", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    logError("cron_failed", { tenantId: uuid, message: `tenant ${uuid} failed` }, "trace-1");
    expect(sentryExtra().tenantId).toBe(uuid); // the whole point of the seam is correlation
    expect(String(sentryExtra().message)).toContain(uuid);
    spy.mockRestore();
  });

  it("SEC-05: leaves ordinary identifiers, counts and codes untouched (no over-scrubbing)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    logError("upload_failed", { uploadRef: "IM-26-014", count: 42, kind: "otp", ok: false });
    expect(sentryExtra()).toMatchObject({ uploadRef: "IM-26-014", count: 42, kind: "otp", ok: false });
    spy.mockRestore();
  });

  it("SEC-05: scrubs nested values too (a wrapped provider payload still leaks otherwise)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    logError("x", { detail: { to: ["partner@real.test"] } });
    expect(JSON.stringify(sentryExtra())).not.toContain("partner@real.test");
    spy.mockRestore();
  });

  it("SEC-05: a value nested past the depth cap is truncated, never emitted unscrubbed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    // Deeper than MAX_SCRUB_DEPTH: the scrubber stops descending here, so it must drop the
    // subtree rather than hand back strings it never inspected. Assert the MARKER, not just
    // the absence of the email — "no leak" alone also passes with no cap at all.
    // Cap is 3, matching Sentry's own normalizeDepth so the two agree.
    logError("x", { a: { b: { c: { d: { leak: "seller@example.com" } } } } });
    expect(sentryExtra()).toEqual({ a: { b: { c: "[truncated]" } } });
    spy.mockRestore();
  });

  it("SEC-05: pins the token threshold — a 23-char run survives, a 24-char run is redacted", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    logError("x", { short: "a".repeat(23), long: "b".repeat(24) });
    expect(sentryExtra()).toEqual({ short: "a".repeat(23), long: "[redacted-token]" });
    spy.mockRestore();
  });

  // The catch that makes this seam safe when the scrubber itself misbehaves. The circular
  // test does NOT reach it (the depth cap terminates first), so without this the branch
  // could be "simplified" to `return detail` — shipping raw PII — with every test green.
  it("SEC-05: fails CLOSED — a scrub-time throw ships a marker, never the raw detail", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    const poison: Record<string, unknown> = { safe: "keep-me" };
    // Object.entries invokes getters, so this throws inside scrubValue.
    Object.defineProperty(poison, "leak", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    logError("x", { poison, email: "seller@example.com" });
    // Deliberately fail-closed over fail-granular: the WHOLE payload is replaced, siblings
    // included, rather than risk emitting a partially-scrubbed object.
    expect(sentryExtra()).toEqual({ scrub_failed: true });
    spy.mockRestore();
  });

  // Reversed after review: the console line is NOT a private channel. SEC-05 says
  // "excluded from logs" unqualified, the host retains stdout, and Sentry's default
  // console integration would re-ship an unscrubbed line as a breadcrumb on the very
  // event whose `extra` we just redacted.
  it("SEC-05: the CONSOLE line is scrubbed too — the host's log store is a third party", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    logError("notify_failed", { message: "sent to seller@example.com" });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.message).toBe("sent to [redacted-email]");
    spy.mockRestore();
  });

  it("SEC-05: the console line is scrubbed even with NO Sentry DSN configured", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(undefined); // dev/CI: no transport, but the host still retains stdout
    logError("notify_failed", { message: "sent to seller@example.com" });
    expect(spy.mock.calls[0][0] as string).not.toContain("seller@example.com");
    spy.mockRestore();
  });

  it("F-42: a caller detail key cannot overwrite the envelope's code/traceId", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    logError("real_code", { code: "spoofed", traceId: "spoofed", level: "info" }, "trace-real");
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ code: "real_code", traceId: "trace-real", level: "error" });
    spy.mockRestore();
  });

  it("SEC-05: scrubbing never breaks the request — a circular detail still sends", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDsn(DSN);
    const circular: Record<string, unknown> = { message: "boom" };
    circular.self = circular;
    expect(() => logError("boom", circular, "t")).not.toThrow();
    expect(captureMessage).toHaveBeenCalled();
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
