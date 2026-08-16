import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local Claude Code state — git worktree checkouts under
    // .claude/worktrees are full copies of this repo and would otherwise be
    // linted again (tens of thousands of duplicate problems).
    ".claude/**",
    // Untracked reference/marketing material kept in the working tree but not
    // part of the app: the Krayin CRM comparison checkout and the marketing
    // capture scripts. They are not ours to lint (C-1).
    "laravel-crm-2.2/**",
    "_marketing/**",
  ]),
]);

export default eslintConfig;
