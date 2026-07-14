import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import * as schema from "../src/db/schema";
import { provisionPartnerUser } from "../src/lib/auth/provision";

// Dev-only: provision a PARTNER portal sign-in (email-OTP, no password) for testing.
// Usage:
//   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs \
//     scripts/provision-partner.ts <email> <partnerRefId=PR-001> [tenantSlug=dev-jv]
//
// The partner logs in at /portal/login with this email; in dev the OTP lands in the
// dev mailbox at /dev/emails. Requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY in the loaded env.

const [, , email, partnerRef = "PR-001", tenantSlug = "dev-jv"] = process.argv;

const dbUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!email) fail("Usage: provision-partner <email> [partnerRefId=JV-001] [tenantSlug=dev-jv]");
if (!dbUrl) fail("DATABASE_URL not set — run with node --env-file=.env.local");
if (!supabaseUrl || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");

const client = postgres(dbUrl, { prepare: false, max: 1 });
const db = drizzle(client, { schema });
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, tenantSlug));
  if (!tenant) fail(`Tenant "${tenantSlug}" not found — run pnpm db:seed first.`);

  const [partner] = await db
    .select({ id: schema.partners.id, name: schema.partners.name })
    .from(schema.partners)
    .where(and(eq(schema.partners.tenantId, tenant.id), eq(schema.partners.refId, partnerRef)));
  if (!partner) fail(`Partner "${partnerRef}" not found in tenant "${tenantSlug}" — run the seeder first.`);

  const { userId, created } = await provisionPartnerUser(admin, db, { tenantId: tenant.id, partnerId: partner.id, email });

  console.log(`${created ? "Created" : "Updated"} partner login ${email} (${userId}) → ${partner.name} (${partnerRef}).`);
  await client.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("Provisioning failed:", e instanceof Error ? e.message : e);
  await client.end();
  process.exit(1);
});
