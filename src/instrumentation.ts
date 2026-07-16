import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";

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
    beforeSend(event) {
      const url = event.request?.url;
      if (url) event.request!.url = url.split("?")[0];
      return event;
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
