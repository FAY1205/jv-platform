import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit + integration tests run under Vitest (node environment by default).
// Component tests (jsdom) and their libraries are added in the component-library WP.
// Playwright e2e specs live under tests/e2e and are excluded here.
export default defineConfig({
  // Automatic JSX runtime for component tests (React 19) without a plugin.
  esbuild: { jsx: "automatic" },
  test: {
    globals: true,
    // Default node env for pure-module tests; component tests opt into jsdom
    // via a `@vitest-environment jsdom` docblock.
    environment: "node",
    // DB integration tests round-trip to a remote pooler; give them headroom.
    // (Unit tests finish in ms, so this only matters when a test genuinely hangs.)
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
