// Registers @testing-library/jest-dom matchers for component tests.
// Safe to load for node-environment tests too (import only extends expect).
import "@testing-library/jest-dom/vitest";
import { beforeAll, expect } from "vitest";

// findBy*/waitFor have their OWN timeout (asyncUtilTimeout), separate from vitest's
// testTimeout above — and it defaults to 1s. A component test that awaits a TanStack
// Query resolution can exceed that under the serial suite's CPU load while passing in
// isolation, which reads as a flaky failure and trains everyone to ignore red CI.
// 5s is still far under testTimeout (30s) and weakens no assertion: an element that
// never appears still fails, just later. Fixes the class, not one test.
import { configure } from "@testing-library/react";
configure({ asyncUtilTimeout: 5000 });

// jsdom implements no ResizeObserver, and several shipped primitives use one (Radix
// Popover, useScrollHint — which N3C-11 wired into every Dialog). Individual suites used to
// hand-roll this stub; one no-op class here covers them all. Guarded so a real
// implementation (a browser-backed runner) always wins.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

// Integration tests read DATABASE_URL from .env.local (Node 22 loadEnvFile).
// Guarded so the unit suite (no DB) and CI (env already set) are unaffected —
// without this the integration suites self-skip instead of running (audit F-02/F-50).
import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// SEC-07 guard (audit R-03): integration suites write to and delete from the database
// DATABASE_URL points at. If it points at the PRODUCTION Supabase project, fail LOUDLY —
// never skip, never proceed. Unit tests never touch the DB and legitimately run while
// .env.local still points at prod (that IS finding R-03), so the guard runs per-test-file
// and only fires for files under tests/integration (which are the ones that connect).
// Registered as a global beforeAll so it trips before any suite's own connect step. The
// known prod ref is pinned; PROD_PROJECT_REF lets ops rotate/extend it without a code change.
beforeAll(() => {
  const testPath = expect.getState().testPath ?? "";
  if (!testPath.replace(/\\/g, "/").includes("/integration/")) return;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const KNOWN_PROD_PROJECT_REF = "vhoiixmhvuwxfyvxtumz";
  const projectRef = /postgres\.([a-z0-9]+):/.exec(dbUrl)?.[1];
  if (
    projectRef !== undefined &&
    (projectRef === KNOWN_PROD_PROJECT_REF || (process.env.PROD_PROJECT_REF !== undefined && projectRef === process.env.PROD_PROJECT_REF))
  ) {
    throw new Error(
      `REFUSING TO RUN INTEGRATION TESTS: DATABASE_URL points at the PRODUCTION Supabase project ("${projectRef}"). ` +
        "These suites create and destroy data. Point DATABASE_URL at a dev/test project " +
        "(see SEC-07: non-production environments use separate Supabase projects).",
    );
  }
});
