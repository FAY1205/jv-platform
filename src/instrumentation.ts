import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";
import { scrubDetail, scrubString } from "@/lib/scrub";

// ADR-0032: Sentry server + edge initialisation. Next calls register() once per runtime
// at boot. SENTRY_DSN is the sole activation switch — unset (dev, test, CI, preview)
// means Sentry is inert and logError stays console-only, exactly as before (SEC-07).
//
// ─── SERVER-ONLY, DELIBERATELY ───────────────────────────────────────────────────────
// There is intentionally NO instrumentation-client.ts / sentry.client.config.ts. The
// browser SDK is a separate opt-in file, so omitting it is what keeps Sentry off the
// client: shipping breadcrumbs, URLs, form values or session replay to a third party is
// exactly what ADR-0031 and SEC-05 forbid. Do not add one — and do not run the Sentry
// install wizard, which creates it — without a follow-up ADR that first defines a PII
// scrubbing policy. `tests/unit/no-client-sentry.test.ts` enforces this.
export async function register(): Promise<void> {
  if (!env.SENTRY_DSN) return;
  const runtime = process.env.NEXT_RUNTIME;
  if (runtime !== "nodejs" && runtime !== "edge") return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    // Error transport, not APM (ADR-0032). Tracing stays off until an ADR asks for it.
    tracesSampleRate: 0,
    // SEC-05 — the LAST line of defence, and the real one. `logError` is PII-free by
    // caller contract, but init() also installs global uncaught-exception /
    // unhandled-rejection capture that never passes through the seam, so the seam is a
    // convenience and this is the boundary.
    //
    // Specifically: the SDK ALWAYS attaches `request.url` (requestdata.js — "No
    // dataCollection equivalent"), so `queryParams: false` below does NOT cover it. We
    // email password-reset links as /reset?token=<live 30-min token>, so an error during
    // that request would hand a third party an account-takeover credential. Strip every
    // query string on the way out — this covers future params for free.
    // WP-SU-3: and scrub the payload here, because THIS is the only path every event
    // takes. `logError` also scrubs, but the global uncaught-exception and
    // unhandled-rejection handlers below never pass through it — an unhandled rejection
    // carrying a Drizzle "Failed query: … params: …" message would otherwise ship every
    // bound seller parameter verbatim as exception.values[].value.
    beforeSend(event) {
      const url = event.request?.url;
      if (url) event.request!.url = url.split("?")[0];
      // THIRD SDK quirk of the same shape as the two above: requestdata.js hardcodes
      // `include.data = true` ("dataCollection.httpBodies gates write-time, not
      // read-time"), so the captured POST body rides on every event raised during that
      // request — the login password, the OTP code, the live reset token, the first 10KB
      // of a lead upload. Suppressed at the source below; deleted here as well.
      if (event.request) {
        delete event.request.data;
        // Same doctrine as the body: do not leave these to config alone. dataCollection
        // pins them off today, but this WP proved that assumption wrong three times.
        delete event.request.cookies;
        delete event.request.headers;
      }
      // WP-SU-10: captureRequestError (the onRequestError path below) puts the request PATH in a
      // CONTEXT — event.contexts.nextjs.request_path — not in event.request.url, so the query-strip
      // above misses it. Reset and signup-verify links carry a live single-use token in the query,
      // which is an account-takeover credential in a third party's store (SEC-05, same reasoning as
      // request.url). Strip it here too; scrub the rest of the context for free.
      const nextjs = event.contexts?.nextjs as Record<string, unknown> | undefined;
      if (nextjs) {
        const path = nextjs.request_path;
        if (typeof path === "string") nextjs.request_path = path.split("?")[0];
        event.contexts!.nextjs = scrubDetail(nextjs);
      }
      if (event.extra) event.extra = scrubDetail(event.extra);
      // Safe to scrub now that the token rule exempts structured identifiers: a
      // length-only rule collapsed 17 distinct alert codes into ONE Sentry issue, which
      // would have destroyed the alerting this ADR exists to buy. Codes round-trip; prose
      // messages (which we do not author) are still redacted.
      // WP-SU-10 (audit-security F-1): captureRequestError sets event.transaction to
      // `${method} ${routePath}`. routePath is the compile-time route TEMPLATE today (no live
      // token), so this is defense-in-depth — but the doctrine here is "scrub every string field,
      // don't trust a framework not to put a concrete path there tomorrow".
      if (event.transaction) event.transaction = scrubString(event.transaction);
      if (event.message) event.message = scrubString(event.message);
      for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrubString(ex.value);
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          ...(b.message ? { message: scrubString(b.message) } : {}),
          ...(b.data ? { data: scrubDetail(b.data) } : {}),
        }));
      }
      return event;
    },
    // Two integrations are replaced, both because their DEFAULTS ingest data we never want
    // to send. Names come from the SDK itself where possible, not string literals, so an
    // upstream rename cannot silently re-enable either path with a green test suite.
    //
    // Accessed dynamically because this file is compiled for BOTH runtimes and
    // `httpIntegration` is not exported from the edge build — a static
    // `Sentry.httpIntegration` reference fails the edge bundle outright. Request-body
    // capture is a Node-only concern anyway (the edge path carries no body).
    integrations: (defaults) => {
      const factories = Sentry as unknown as Record<string, ((o?: unknown) => { name: string }) | undefined>;
      const consoleName = factories.consoleIntegration?.().name ?? "Console";
      const httpFactory = factories.httpIntegration;
      // Literal fallback, symmetric with Console: filter the body-capturing default by name
      // even on a runtime that cannot supply the factory to replace it. Without this, an
      // SDK that ever shipped an Http default there would silently re-arm body capture.
      const httpName = httpFactory?.().name ?? "Http";
      // Console patches console.* and attaches the RAW arguments as a breadcrumb; our
      // console line is already scrubbed, but this removes the ingestion path entirely.
      const kept = defaults.filter((i) => i.name !== consoleName && i.name !== httpName);
      // Http captures up to 10KB of every incoming request body by default
      // (maxRequestBodySize: "medium") — NOT gated by dataCollection.httpBodies. Turn it
      // off at the source; keep the Next SDK's own disableIncomingRequestSpans default.
      return httpFactory
        ? kept.concat(httpFactory({ disableIncomingRequestSpans: true, maxIncomingRequestBodySize: "none" }))
        : kept;
    },
    // v10 RESOLVES dataCollection.stackFrameVariables but never reads it; the
    // local-variables integration gates on THIS option instead. Without it, locals are
    // off only by luck of the default. Keep both until v11 reads the dataCollection key.
    includeLocalVariables: false,
    // Sentry enriches events automatically, and several of these default to ON. On this
    // app each default is a PII or secret leak, so every one is pinned off explicitly
    // rather than left to a library default we don't control:
    dataCollection: {
      userInfo: false, // no user identity on events
      cookies: false, // the __Host- session cookie is a bearer token (AUT-12, SEC-05)
      httpHeaders: { request: false, response: false }, // Authorization: Bearer CRON_SECRET
      httpBodies: [], // a lead upload body is raw seller PII (ADR-0031)
      queryParams: false, // drops query_string; see beforeSend for request.url
      genAI: { inputs: false, outputs: false }, // defaults ON once dataCollection is set; we run an AI assistant
      stackFrameVariables: false, // no-op in v10 (see includeLocalVariables); set for v11
    },
  });
}

/**
 * WP-SU-10 / ACT-03: Next calls this for every error thrown out of a route handler, server
 * component render, or server action. Without it, App Router handler errors reached NO sink of
 * ours — `logError` only sees the errors we catch ourselves, so an uncaught throw out of a route
 * was invisible (instrumentation.ts previously exported only `register`).
 *
 * Delegates to the SDK rather than re-implementing capture, so the exception arrives with its
 * stack and Next's routing context. Everything it produces still passes through the `beforeSend`
 * above, which is where the scrubbing happens — including request_path (see the note there; that
 * field is the reason this WP touched beforeSend at all).
 *
 * Gated on SENTRY_DSN to mirror `register`: without init, capture is a silent no-op anyway, but an
 * explicit gate is testable and says what we mean (SEC-07: inert in dev/test/CI/preview).
 *
 * Types come from the SDK, not from `next`: Next 16 does not re-export the `Instrumentation`
 * namespace from the package root, and a deep import into next/dist/server/... is not a stable
 * contract to bind to.
 *
 * ACCEPTED RESIDUAL (ADR-0032): uncaught errors PRINTED by Next/Node still reach the hosting
 * provider's log store before any of our code runs. This closes the Sentry gap, not that one.
 */
type CaptureArgs = Parameters<typeof Sentry.captureRequestError>;

export function onRequestError(error: unknown, request: CaptureArgs[1], context: CaptureArgs[2]): void {
  if (!env.SENTRY_DSN) return;
  try {
    Sentry.captureRequestError(error, request, context);
  } catch {
    // Error reporting must never break error handling — but leave ONE first-party trace that the
    // transport itself failed (pr-reviewer F-1, mirroring logError's console-then-Sentry split).
    // Console only, no Sentry retry: Sentry is the thing that just threw. Static payload, no PII.
    try {
      console.error(JSON.stringify({ level: "error", scope: "server", code: "sentry_capture_request_error_failed" }));
    } catch {
      // A console failure must not break error handling either.
    }
  }
}
