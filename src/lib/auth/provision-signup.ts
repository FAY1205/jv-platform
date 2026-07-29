import { randomUUID, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SupabaseClient } from "@supabase/supabase-js";
// Relative (not "@/") so this helper runs unchanged from the app, the vitest
// integration test, AND any tsx provisioning script (tsx does not resolve "@/").
import * as schema from "../../db/schema";
import { recordTosAcceptance } from "./tos-store";
import { CURRENT_TOS_VERSION } from "@/lib/legal/tos";

type DB = PostgresJsDatabase<typeof schema>;

// A URL-safe workspace slug from a display name; empty → "workspace"; capped length.
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

export interface ProvisionSignupParams {
  email: string;
  password: string;
  workspaceName: string;
}

// Thrown when the Supabase auth user already exists for this email (a race with a
// concurrent signup, or an orphaned auth user from a previously failed attempt). The
// route treats this identically to the pre-check "already registered" path.
export class SignupEmailExistsError extends Error {}

// SCP-02 (ADR-0033): create the auth user (unconfirmed) + tenant + admin user atomically.
// Compensating saga: auth user is created first; if the DB transaction fails, the auth user
// is deleted so no orphan remains. Password is passed to Supabase only — never logged.
export async function provisionSignup(
  admin: SupabaseClient,
  db: DB,
  { email, password, workspaceName }: ProvisionSignupParams,
): Promise<{ userId: string; tenantId: string }> {
  const tenantId = randomUUID();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false, // verification gates login (activated by the verify endpoint)
    app_metadata: { tenant_id: tenantId, role: "admin" as const },
  });
  const userId = created.data.user?.id;
  if (created.error || !userId) {
    if (created.error && /already.*registered|already.*exist|email.*exists/i.test(created.error.message)) {
      throw new SignupEmailExistsError();
    }
    throw new Error(`signup provisioning: could not create auth user: ${created.error?.message ?? "unknown"}`);
  }
  try {
    let slug = slugify(workspaceName);
    const clash = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug));
    if (clash.length) slug = `${slug}-${randomBytes(3).toString("hex")}`;
    await db.transaction(async (tx) => {
      // selfServe marks this tenant as PUBLICLY self-registered (LGL-01, WP-SU-5): its admin
      // accepted the ToS below, so it is subject to re-acceptance on a version bump — unlike
      // owner/script-provisioned tenants, which have no acceptance record and stay exempt.
      await tx.insert(schema.tenants).values({ id: tenantId, name: workspaceName, slug, selfServe: true });
      await tx.insert(schema.users).values({ id: userId, tenantId, email, role: "admin" });
      // Compliance: audit the highest-privilege public action (creating a whole tenant). B2B/self
      // contact data (like partner.created) — no consumer-PII redaction needed.
      await tx.insert(schema.auditLog).values({
        tenantId, actorUserId: userId, action: "tenant.signup_provisioned",
        // selfServe is in the snapshot because it is what decides whether this tenant's
        // admins are ever ToS-re-gated — an auditor must be able to answer "which tenants
        // were subject to that, and since when" from the trail alone (DM-04).
        entityType: "tenant", entityRef: tenantId, after: { name: workspaceName, slug, selfServe: true },
      });
      // LGL-01: record ToS/Privacy acceptance captured at signup, atomically with provisioning.
      await recordTosAcceptance(tx, userId, CURRENT_TOS_VERSION);
    });
    return { userId, tenantId };
  } catch (e) {
    // Compensate: the DB rows never landed, so the auth user must not survive.
    await admin.auth.admin.deleteUser(userId);
    throw e;
  }
}
