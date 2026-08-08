// Applies pending drizzle migrations during a Vercel PRODUCTION build.
//
// Why here: the prod DATABASE_URL lives only in Vercel (R-03), so the deploy is the
// one place that can reach prod. Running `drizzle-kit migrate` on each production
// build keeps prod's schema — and drizzle's own migration ledger (drizzle.__drizzle_migrations)
// — authoritative, with no DB credentials duplicated into CI or a developer's machine.
//
// Safety:
//   - Runs ONLY when VERCEL_ENV === "production". Preview and local builds skip it, so
//     a preview deploy can never mutate the prod DB (SEC-07).
//   - Migrations are forward-only (API-04); `drizzle-kit migrate` is a no-op when
//     nothing is pending, so redeploys are safe to repeat.
//   - A failed migration fails the build and blocks that deploy — intended.
//   - Keep migrations expand/contract (backward-compatible with the currently-live
//     code): this runs during the build, before the new deployment serves traffic.
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV ?? "(unset)";

if (env !== "production") {
  console.log(`[deploy-migrate] VERCEL_ENV=${env} → skipping migrations (non-production build)`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("[deploy-migrate] VERCEL_ENV=production but DATABASE_URL is unset — refusing to build.");
  process.exit(1);
}

console.log("[deploy-migrate] VERCEL_ENV=production → applying pending migrations");
execSync("pnpm run db:migrate", { stdio: "inherit" });
console.log("[deploy-migrate] schema up to date");
