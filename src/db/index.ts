import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Server-only database client (Drizzle over postgres-js). The service-role
// connection bypasses RLS and MUST only ever be used behind the scoping guard
// (lib/scope.ts, WP-006) — never trust it with an unscoped query (PRN-08, SEC-01).
// ─────────────────────────────────────────────────────────────────────────────

// The client/db are cached on globalThis, not just at module scope. In Next.js
// dev, HMR re-evaluates this module on every edit; a plain module-level
// singleton would leak a fresh postgres connection pool each reload until the
// Supabase pooler's connection limit is hit and queries start failing ("no data
// loading"). Pinning to globalThis makes one pool survive across HMR reloads.
// In production there is no HMR, so this is just a normal singleton.
const globalForDb = globalThis as unknown as {
  __jvClient?: ReturnType<typeof postgres>;
  __jvDb?: PostgresJsDatabase<typeof schema>;
};

/** Lazily create the singleton DB client. Throws a clear error if unconfigured. */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!globalForDb.__jvDb) {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — cannot open a database connection.");
    }
    // prepare:false works with Supabase's transaction-mode pooler; idle_timeout
    // returns idle connections to the pooler so they don't accumulate.
    globalForDb.__jvClient = postgres(env.DATABASE_URL, { prepare: false, idle_timeout: 20 });
    globalForDb.__jvDb = drizzle(globalForDb.__jvClient, { schema });
  }
  return globalForDb.__jvDb;
}

export { schema };
export * from "./ref-ids";
