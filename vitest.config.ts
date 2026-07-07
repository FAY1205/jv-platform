import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit + integration tests run under Vitest (node environment by default).
// Component tests (jsdom) and their libraries are added in the component-library WP.
// Playwright e2e specs live under tests/e2e and are excluded here.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
