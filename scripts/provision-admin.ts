import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import * as schema from "../src/db/schema";
import { provisionAdmin } from "../src/lib/auth/provision";

// Dev-only: provision an admin sign-in for the dev tenant.
// Usage:
//   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs \
//     scripts/provision-admin.ts <email> <password> [tenantSlug=dev-jv]
//
// Requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in
// the loaded env. The password is sent to Supabase Auth only — never logged.

const [, , email, password, tenantSlug = "dev-jv"] = process.argv;

const dbUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!email || !password) fail("Usage: provision-admin <email> <password> [tenantSlug]");
if (!dbUrl) fail("DATABASE_URL not set — run with node --env-file=.env.local");
if (!supabaseUrl || !serviceKey) {
  fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to provision an admin.");
}

const client = postgres(dbUrl, { prepare: false, max: 1 });
const db = drizzle(client, { schema });
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, tenantSlug));
  if (!tenant) fail(`Tenant "${tenantSlug}" not found — run pnpm db:seed first.`);

  const { userId, created } = await provisionAdmin(admin, db, {
    tenantId: tenant.id,
    email,
    password,
  });

  console.log(`${created ? "Created" : "Updated"} admin ${email} (${userId}) for tenant "${tenantSlug}".`);
  await client.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("Provisioning failed:", e instanceof Error ? e.message : e);
  await client.end();
  process.exit(1);
});
