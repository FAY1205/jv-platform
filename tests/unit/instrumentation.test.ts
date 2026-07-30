import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";

// ADR-0032 / SEC-05: the seam keeps PII out of what we SEND, but Sentry also enriches
// events automatically — and its defaults collect cookies, request headers, request
// bodies and stack-frame local variables. On this app those are, respectively: the
// __Host- session cookie (AUT-12), the CRON_SECRET bearer, raw lead uploads, and
// seller fields sitting in an editLead frame. Every one is pinned off here, because a
// default flipping back on is a silent PII leak to a third party.
// consoleIntegration/httpIntegration are used for their SDK-reported NAMES (so an upstream
// rename can't silently re-enable those ingestion paths) and to re-add Http with request
// body capture disabled.
vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  consoleIntegration: vi.fn(() => ({ name: "Console" })),
  httpIntegration: vi.fn(() => ({ name: "Http" })),
  captureRequestError: vi.fn(),
}));

const init = vi.mocked(Sentry.init);
const httpIntegration = vi.mocked(Sentry.httpIntegration);
const setDsn = (dsn: string | undefined) => {
  (env as { SENTRY_DSN?: string }).SENTRY_DSN = dsn;
};

// No vi.resetModules(): a reset would give @/instrumentation its OWN fresh copy of
// @/lib/env, and setDsn would then be mutating a different object than register() reads.
// register() reads env.SENTRY_DSN at call time, so one shared import is correct here.
const loadRegister = async () => (await import("@/instrumentation")).register;

// beforeSend's real signature is (event, hint); narrow to just what these tests exercise.
type ScrubbedEvent = { request?: { url?: string } };
type BeforeSend = (event: ScrubbedEvent, hint: unknown) => ScrubbedEvent;
const beforeSendFn = () => init.mock.calls[0][0].beforeSend as unknown as BeforeSend;

beforeEach(() => {
  init.mockReset();
  setDsn(undefined);
  process.env.NEXT_RUNTIME = "nodejs";
});

describe("ADR-0032: Sentry server init", () => {
  it("ADR-0032: does not initialise Sentry when SENTRY_DSN is unset (inert in dev/test/CI)", async () => {
    const register = await loadRegister();
    await register();
    expect(init).not.toHaveBeenCalled();
  });

  it("ADR-0032: initialises with the DSN when set", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).toMatchObject({ dsn: "https://key@o1.ingest.sentry.io/1" });
  });

  it("SEC-05: never collects cookies, request headers, bodies, query params or frame locals", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    expect(init.mock.calls[0][0]).toMatchObject({
      dataCollection: {
        userInfo: false,
        cookies: false, // __Host- session cookie must never leave the app (AUT-12)
        httpHeaders: { request: false, response: false }, // CRON_SECRET bearer
        httpBodies: [], // raw lead uploads = seller PII
        queryParams: false,
        stackFrameVariables: false, // an editLead frame holds seller name/phone in locals
      },
    });
  });

  // The SDK ALWAYS attaches request.url — requestdata.js literally says "No
  // dataCollection equivalent — URL is always included", so `queryParams: false` only
  // drops the separate query_string field. This app emails /reset?token=<live token>, so
  // any server error during that request would ship an account-takeover credential to a
  // third party (SEC-05). beforeSend — not logError — is the real boundary, because
  // init() also installs global uncaught/unhandled capture that bypasses the seam.
  it("SEC-05: beforeSend strips the query string from request.url (the reset token)", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    const scrubbed = beforeSendFn()(
      { request: { url: "https://app.example.com/reset?token=SUPER_SECRET_RESET_TOKEN" } },
      {},
    );
    expect(scrubbed.request?.url).toBe("https://app.example.com/reset");
    expect(JSON.stringify(scrubbed)).not.toContain("SUPER_SECRET_RESET_TOKEN");
  });

  it("SEC-05: beforeSend leaves a url without a query string alone, and tolerates no request", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    const beforeSend = beforeSendFn();
    expect(beforeSend({ request: { url: "https://app.example.com/leads" } }, {}).request?.url).toBe(
      "https://app.example.com/leads",
    );
    expect(() => beforeSend({}, {})).not.toThrow(); // events without request context still send
  });

  // dataCollection.stackFrameVariables is RESOLVED but never read in v10 — the
  // local-variables integration gates on includeLocalVariables. Pin the one the SDK
  // actually reads, or an editLead frame's seller name/phone leaks the day someone
  // flips locals on to debug — and the dataCollection assertion would stay green.
  it("SEC-05: pins includeLocalVariables off — the option the v10 SDK actually reads", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    expect(init.mock.calls[0][0]).toMatchObject({ includeLocalVariables: false });
  });

  // genAI defaults to {inputs:true, outputs:true} once dataCollection is provided at all.
  // Inert while tracesSampleRate is 0, but this repo has a live AI assistant and raising
  // the sample rate is a plausible future tweak.
  it("SEC-05: pins genAI input/output capture off", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    expect(init.mock.calls[0][0]).toMatchObject({ dataCollection: { genAI: { inputs: false, outputs: false } } });
  });

  // WP-SU-3: beforeSend is the only path EVERY event takes — logError's scrub does not
  // cover the global uncaught-exception / unhandled-rejection handlers init() installs.
  it("SEC-05: beforeSend scrubs extra, message, exception values and breadcrumbs", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    const beforeSend = beforeSendFn();
    const scrubbed = beforeSend(
      {
        extra: { message: "mail to seller@example.com" },
        message: "failed for seller@example.com",
        exception: { values: [{ value: 'Failed query: insert into "leads"\nparams: Jane,5551234567' }] },
        breadcrumbs: [{ message: "console: seller@example.com", data: { arguments: ["seller@example.com"] } }],
      } as never,
      {},
    ) as unknown as Record<string, unknown>;
    expect(JSON.stringify(scrubbed)).not.toContain("seller@example.com");
    expect(JSON.stringify(scrubbed)).not.toContain("5551234567");
    expect(JSON.stringify(scrubbed)).not.toContain("Jane");
  });

  // WP-SU-10: captureRequestError writes request.path into contexts.nextjs.request_path — a field
  // the url-stripping above does NOT cover. We email /reset?token=<live token>, so a throw during
  // that request would ship an account-takeover credential (SEC-05).
  it("SEC-05: beforeSend strips the query from contexts.nextjs.request_path", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    const out = beforeSendFn()(
      { contexts: { nextjs: { request_path: "/reset?token=SUPER_SECRET_RESET_TOKEN", route_type: "route" } } } as never,
      {},
    ) as unknown as { contexts?: { nextjs?: { request_path?: string } } };
    expect(out.contexts?.nextjs?.request_path).toBe("/reset");
    expect(JSON.stringify(out)).not.toContain("SUPER_SECRET_RESET_TOKEN");
  });

  // WP-SU-10: captureRequestError sets event.transaction to `${method} ${routePath}`. Defense-in-
  // depth — routePath is a template today, but every string field gets scrubbed on principle. Use
  // an email (which scrubString reliably redacts) to prove the scrub is actually applied here.
  it("SEC-05: beforeSend scrubs event.transaction", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    const out = beforeSendFn()(
      { transaction: "POST /admin seller@example.com" } as never,
      {},
    ) as unknown as { transaction?: string };
    expect(out.transaction).not.toContain("seller@example.com");
  });

  it("SEC-05: deletes the captured request body — password/OTP/reset-token ride on it", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    const scrubbed = beforeSendFn()(
      { request: { url: "https://app.test/api/auth/login", data: '{"password":"hunter2"}' } } as never,
      {},
    ) as unknown as { request?: { data?: unknown } };
    expect(scrubbed.request?.data).toBeUndefined();
  });

  it("ADR-0032: does NOT scrub the event title — it is our own alert code, and 17 would collapse into one issue", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    const out = beforeSendFn()({ message: "cron_drain_tenant_failed" } as never, {}) as unknown as {
      message?: string;
    };
    expect(out.message).toBe("cron_drain_tenant_failed");
  });

  it("SEC-05: drops console + body-capturing http integrations, matched by SDK-reported name", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    const integrations = init.mock.calls[0][0].integrations as (
      d: { name: string }[],
    ) => { name: string }[];
    const kept = integrations([{ name: "Console" }, { name: "Http" }, { name: "OnUncaughtException" }]);
    expect(kept.map((i) => i.name)).toEqual(["OnUncaughtException", "Http"]); // Http re-added, bodies off
    expect(httpIntegration).toHaveBeenCalledWith({
      disableIncomingRequestSpans: true,
      maxIncomingRequestBodySize: "none",
    });
  });

  it("ADR-0032: buys error transport, not APM — no performance tracing", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    expect(init.mock.calls[0][0]).toMatchObject({ tracesSampleRate: 0 });
  });

  it("ADR-0032: does not initialise on an unknown runtime (the browser is not ours to touch)", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    process.env.NEXT_RUNTIME = "";
    const register = await loadRegister();
    await register();
    expect(init).not.toHaveBeenCalled();
  });
});
