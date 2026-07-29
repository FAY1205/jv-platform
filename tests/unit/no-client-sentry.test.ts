import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ADR-0032: Sentry is server-only. The browser SDK would ship breadcrumbs, URLs and form
// values to a third party — the consumer-PII leak ADR-0031 exists to prevent.
//
// This is a POLICY guard, not a feature test. It exists because the natural way to add
// Sentry — `npx @sentry/wizard` — creates a client config without asking, and nothing
// else in the suite would notice. Reopening this needs an ADR defining a scrubbing
// policy first; deleting this test is not that ADR.
const root = process.cwd();

// The filenames the Sentry SDK/wizard recognises as a browser entry point.
const CLIENT_INIT_FILES = [
  "instrumentation-client.ts",
  "instrumentation-client.js",
  "sentry.client.config.ts",
  "sentry.client.config.js",
  "src/instrumentation-client.ts",
  "src/instrumentation-client.js",
  "src/sentry.client.config.ts",
  "src/sentry.client.config.js",
];

const sourceFiles = () =>
  readdirSync(resolve(root, "src"), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => join(root, "src", f));

describe("ADR-0032: Sentry never reaches the browser", () => {
  it("ADR-0032: no client-side Sentry init file exists", () => {
    expect(CLIENT_INIT_FILES.filter((f) => existsSync(resolve(root, f)))).toEqual([]);
  });

  it("ADR-0032: no 'use client' module imports the Sentry SDK", () => {
    const offenders = sourceFiles().filter((file) => {
      const src = readFileSync(file, "utf8");
      const isClient = /^\s*["']use client["']/m.test(src.slice(0, 500));
      return isClient && /from\s+["']@sentry\//.test(src);
    });
    expect(offenders).toEqual([]);
  });

  // Direct-import scanning alone is too narrow: nothing imports @sentry/* into a client
  // file by accident, but importing logError — which reads like a generic helper — would
  // drag the SDK in transitively and this suite would have said nothing. Guard the seam
  // and its one re-exporter (http.ts imports logError) by name.
  it("ADR-0032: no 'use client' module imports the server-only logError seam", () => {
    const offenders = sourceFiles().filter((file) => {
      const src = readFileSync(file, "utf8");
      const isClient = /^\s*["']use client["']/m.test(src.slice(0, 500));
      return isClient && /from\s+["']@\/lib\/(observability|http)["']/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("ADR-0032: only the seam, the instrumentation file and the cron routes import Sentry", () => {
    const allowed = new Set(
      [
        "src/lib/observability.ts", // the transport seam
        "src/lib/cron-monitors.ts", // type-only import, erased at runtime
        "src/instrumentation.ts", // server + edge init
        "src/app/api/cron/drain-outbox/route.ts", // ACT-05 check-in
        "src/app/api/cron/retention-sweep/route.ts", // ACT-05 check-in
        "src/app/api/cron/signup-sweep/route.ts", // ACT-05 check-in (WP-SU-2)
      ].map((p) => resolve(root, p)),
    );
    const importers = sourceFiles().filter((f) => /from\s+["']@sentry\//.test(readFileSync(f, "utf8")));
    expect(importers.filter((f) => !allowed.has(f))).toEqual([]);
  });
});
