import { defineConfig } from "drizzle-kit";

// Migrations are forward-only, reviewed, and applied via CI (API-04). RLS policies
// and the reference-ID function ship as custom SQL migrations alongside the schema.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
