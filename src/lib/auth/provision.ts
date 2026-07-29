import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SupabaseClient } from "@supabase/supabase-js";
// Relative (not "@/") so this helper runs unchanged from the app, the vitest
// integration test, AND the tsx provisioning script (tsx does not resolve "@/").
import * as schema from "../../db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Admin provisioning (WP-023). Creates/updates a Supabase auth user for an admin
// and mirrors it into the app `users` table (id = auth uid). app_metadata carries
// tenant_id + role so the RLS backstop (0001 migration) has claims for any
// authenticated DB path. Passwords are passed to Supabase only — never logged.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

export interface ProvisionAdminParams {
  tenantId: string;
  email: string;
  password: string;
}

export interface ProvisionAdminResult {
  userId: string;
  created: boolean;
}

async function findAuthUserByEmail(admin: SupabaseClient, email: string) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

export async function provisionAdmin(
  admin: SupabaseClient,
  db: DB,
  { tenantId, email, password }: ProvisionAdminParams,
): Promise<ProvisionAdminResult> {
  const app_metadata = { tenant_id: tenantId, role: "admin" as const };

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata,
  });

  let userId = created.data.user?.id;
  let wasCreated = true;
  if (created.error || !userId) {
    // Most likely already registered — find and update it instead.
    const existing = await findAuthUserByEmail(admin, email);
    if (!existing) {
      throw new Error(`Could not create or locate auth user for ${email}: ${created.error?.message ?? "unknown"}`);
    }
    userId = existing.id;
    wasCreated = false;
    // email_confirm:true unconditionally (AUT-05, WP-SU-2 item 3): provisionSignup is the ONLY
    // path that leaves an auth user unconfirmed, and the sweep's "unconfirmed + signup marker ⇒
    // delete" discriminator rests on that. A re-provisioned admin must never linger unconfirmed.
    const upd = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true, app_metadata });
    if (upd.error) throw upd.error;
  }

  // Mirror into the app users table (id = auth uid), upserting by id.
  await db
    .insert(schema.users)
    .values({ id: userId, tenantId, email, role: "admin" })
    .onConflictDoUpdate({ target: schema.users.id, set: { email, role: "admin", tenantId } });

  return { userId, created: wasCreated };
}

/** Remove a provisioned admin (auth user + users row). For test/dev cleanup only. */
export async function deprovisionAdmin(admin: SupabaseClient, db: DB, userId: string): Promise<void> {
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  await admin.auth.admin.deleteUser(userId);
}

export interface ProvisionPartnerParams {
  tenantId: string;
  partnerId: string;
  email: string;
}

/**
 * Create/update a Supabase auth user for a partner (PTL-01). Partners have NO
 * password — they log in via email-OTP — so no password is set. app_metadata
 * carries tenant_id/role/partner_id for the RLS backstop; the users row mirrors it.
 */
export async function provisionPartnerUser(
  admin: SupabaseClient,
  db: DB,
  { tenantId, partnerId, email }: ProvisionPartnerParams,
): Promise<ProvisionAdminResult> {
  const app_metadata = { tenant_id: tenantId, role: "partner" as const, partner_id: partnerId };

  const created = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata });
  let userId = created.data.user?.id;
  let wasCreated = true;
  if (created.error || !userId) {
    const existing = await findAuthUserByEmail(admin, email);
    if (!existing) {
      throw new Error(`Could not create or locate partner auth user for ${email}: ${created.error?.message ?? "unknown"}`);
    }
    userId = existing.id;
    wasCreated = false;
    // email_confirm:true unconditionally (AUT-05, WP-SU-2 item 3): partners are OTP-only, so a
    // re-provisioned partner must stay confirmed and never become a false sweep candidate.
    const upd = await admin.auth.admin.updateUserById(userId, { email_confirm: true, app_metadata });
    if (upd.error) throw upd.error;
  }

  await db
    .insert(schema.users)
    .values({ id: userId, tenantId, email, role: "partner", partnerId })
    .onConflictDoUpdate({ target: schema.users.id, set: { email, role: "partner", tenantId, partnerId } });

  return { userId, created: wasCreated };
}
