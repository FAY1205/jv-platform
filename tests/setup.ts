// Registers @testing-library/jest-dom matchers for component tests.
// Safe to load for node-environment tests too (import only extends expect).
import "@testing-library/jest-dom/vitest";

// Integration tests read DATABASE_URL from .env.local (Node 22 loadEnvFile).
// Guarded so the unit suite (no DB) and CI (env already set) are unaffected —
// without this the integration suites self-skip instead of running (audit F-02/F-50).
import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
