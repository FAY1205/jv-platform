// Registers @testing-library/jest-dom matchers for component tests.
// Safe to load for node-environment tests too (import only extends expect).
import "@testing-library/jest-dom/vitest";

// findBy*/waitFor have their OWN timeout (asyncUtilTimeout), separate from vitest's
// testTimeout above — and it defaults to 1s. A component test that awaits a TanStack
// Query resolution can exceed that under the serial suite's CPU load while passing in
// isolation, which reads as a flaky failure and trains everyone to ignore red CI.
// 5s is still far under testTimeout (30s) and weakens no assertion: an element that
// never appears still fails, just later. Fixes the class, not one test.
import { configure } from "@testing-library/react";
configure({ asyncUtilTimeout: 5000 });

// Integration tests read DATABASE_URL from .env.local (Node 22 loadEnvFile).
// Guarded so the unit suite (no DB) and CI (env already set) are unaffected —
// without this the integration suites self-skip instead of running (audit F-02/F-50).
import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
