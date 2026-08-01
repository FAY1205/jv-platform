import { randomUUID, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SupabaseClient } from "@supabase/supabase-js";
// Relative (not "@/") so this helper runs unchanged from the app, the vitest
// integration test, AND any tsx provisioning script (tsx does not resolve "@/").
import * as schema from "../../db/schema";
import { seedTenantRules } from "../../db/seed-tenant-rules";
import { recordTosAcceptance } from "./tos-store";
import { CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import { logError } from "@/lib/observability";
import { pgErrorInfo } from "@/lib/db/pg-error";

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

// WP-SU-7: the clash check above is a read-then-insert, so two concurrent signups for the
// same workspace name both see "no clash" and the second violates tenants.slug UNIQUE at
// INSERT time. Without this the whole signup fails, the compensating delete removes the
// auth user, and the person is told something generic went wrong — for a name collision
// the app can simply resolve itself.
//
// Only a slug-unique violation is retried, with a fresh suffix each time. Any other error
// (including a unique violation on a DIFFERENT constraint, e.g. the user's email) is
// rethrown immediately so real failures still compensate.
const SLUG_RETRIES = 3;

function isSlugUniqueViolation(e: unknown): boolean {
  // Shared cause-chain walker (src/lib/db/pg-error.ts) rather than a local two-level check:
  // WP-SU-2 already established that a shallow read misses a drizzle-wrapped driver error,
  // and having two unwrap strategies for one problem is exactly the drift to avoid.
  const { code, constraint } = pgErrorInfo(e);
  if (code !== "23505") return false;
  // Exact, no "unknown ⇒ assume slug" fallback: postgres.js always populates the constraint
  // name for a server-side 23505, so guessing here would be a fail-open default sitting
  // inside a compensating saga.
  return (constraint ?? "").includes("slug");
}

async function insertWithSlugRetry(
  db: DB,
  initialSlug: string,
  run: (tx: Parameters<Parameters<DB["transaction"]>[0]>[0], slug: string) => Promise<void>,
): Promise<void> {
  let slug = initialSlug;
  for (let attempt = 1; ; attempt++) {
    try {
      await db.transaction(async (tx) => run(tx, slug));
      return;
    } catch (e) {
      if (attempt >= SLUG_RETRIES || !isSlugUniqueViolation(e)) throw e;
      // The recoverable branch neither rethrows nor logs otherwise — so a real collision
      // (this fix actually firing) would leave no trace at all. No slug or workspace name:
      // that is user-supplied content, and the attempt number is the diagnostic (SEC-05).
      logError("signup_slug_collision_retried", { attempt });
      slug = `${slugify(initialSlug)}-${randomBytes(3).toString("hex")}`;
    }
  }
}

export interface ProvisionSignupParams {
  email: string;
  password: string;
  workspaceName: string;
  /** SCP-03: the invitation code row to consume atomically with provisioning. When
   *  set, provisioning fails (and compensates) if the code was already redeemed. */
  signupCodeId?: string;
}

// Thrown when the Supabase auth user already exists for this email (a race with a
// concurrent signup, or an orphaned auth user from a previously failed attempt). The
// route treats this identically to the pre-check "already registered" path.
export class SignupEmailExistsError extends Error {}

// SCP-03: thrown when the invitation code was consumed by a concurrent signup between
// the route's up-front validity check and this transaction (single-use, first wins).
export class SignupCodeConsumedError extends Error {}

// SCP-02 (ADR-0033): create the auth user (unconfirmed) + tenant + admin user atomically.
// Compensating saga: auth user is created first; if the DB transaction fails, the auth user
// is deleted so no orphan remains. Password is passed to Supabase only — never logged.
export async function provisionSignup(
  admin: SupabaseClient,
  db: DB,
  { email, password, workspaceName, signupCodeId }: ProvisionSignupParams,
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
    await insertWithSlugRetry(db, slug, async (tx, finalSlug) => {
      // selfServe marks this tenant as PUBLICLY self-registered (LGL-01, WP-SU-5): its admin
      // accepted the ToS below, so it is subject to re-acceptance on a version bump — unlike
      // owner/script-provisioned tenants, which have no acceptance record and stay exempt.
      await tx.insert(schema.tenants).values({ id: tenantId, name: workspaceName, slug: finalSlug, selfServe: true });
      await tx.insert(schema.users).values({ id: userId, tenantId, email, role: "admin" });
      // SCP-03: burn the invitation code atomically with the tenant it creates. The
      // conditional `used_at IS NULL` guard makes it single-use even under a concurrent
      // race; if it lost the race (0 rows), the whole signup rolls back + compensates.
      if (signupCodeId) {
        const consumed = await tx
          .update(schema.signupCodes)
          .set({ usedAt: new Date(), usedByTenantId: tenantId })
          .where(and(eq(schema.signupCodes.id, signupCodeId), isNull(schema.signupCodes.usedAt)))
          .returning({ id: schema.signupCodes.id });
        if (consumed.length === 0) throw new SignupCodeConsumedError();
      }
      // WP-SU-21: seed the partner-independent ingestion config (Lead Source 1 profile + MLS v2
      // patterns + setting/feature defaults) INSIDE this transaction, so a self-serve tenant is never
      // created without the config it needs to import leads. Partners/coverage/state-rules stay the
      // admin's in-app setup (see seedTenantRules). Failure rolls back the whole signup (compensated).
      await seedTenantRules(tx, tenantId);
      // Compliance: audit the highest-privilege public action (creating a whole tenant). B2B/self
      // contact data (like partner.created) — no consumer-PII redaction needed.
      await tx.insert(schema.auditLog).values({
        tenantId, actorUserId: userId, action: "tenant.signup_provisioned",
        // selfServe is in the snapshot because it is what decides whether this tenant's
        // admins are ever ToS-re-gated — an auditor must be able to answer "which tenants
        // were subject to that, and since when" from the trail alone (DM-04).
        entityType: "tenant", entityRef: tenantId, after: { name: workspaceName, slug: finalSlug, selfServe: true },
      });
      // LGL-01: record ToS/Privacy acceptance captured at signup, atomically with provisioning.
      await recordTosAcceptance(tx, userId, CURRENT_TOS_VERSION);
    });
    return { userId, tenantId };
  } catch (e) {
    // Compensate: the DB rows never landed, so the auth user must not survive. The admin
    // client RETURNS {error} rather than throwing, so discarding the result would make a
    // failed compensation invisible — the abandoned-signup sweep would later have to
    // discover the orphan instead of merely confirming a known one.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) logError("signup_compensation_failed", { userId });
    throw e;
  }
}
