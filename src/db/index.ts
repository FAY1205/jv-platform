import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Server-only database client (Drizzle over postgres-js). The service-role
// connection bypasses RLS and MUST only ever be used behind the scoping guard
// (lib/scope.ts, WP-006) — never trust it with an unscoped query (PRN-08, SEC-01).
// ─────────────────────────────────────────────────────────────────────────────

let client: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

/** Lazily create the singleton DB client. Throws a clear error if unconfigured. */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!db) {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — cannot open a database connection.");
    }
    // prepare:false works with Supabase's transaction-mode pooler.
    client = postgres(env.DATABASE_URL, { prepare: false });
    db = drizzle(client, { schema });
  }
  return db;
}

export { schema };
export * from "./ref-ids";
