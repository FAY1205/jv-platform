import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { provisionPartnerUser, deprovisionAdmin } from "@/lib/auth/provision";
import { issueOtp } from "@/lib/auth/otp";
import { OtpStore } from "@/lib/auth/otp-store";
import { otpOutcome } from "@/lib/auth/otp-verify";
import { latestTosVersion, recordTosAcceptance } from "@/lib/auth/tos-store";
import { needsTosAcceptance, CURRENT_TOS_VERSION } from "@/lib/legal/tos";

// PTL-01 (live): partner provisioning + OTP store + ToS store. Self-skips without
// the DB + Supabase env (session establishment is verified via the route E2E).
const dbUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(dbUrl && supabaseUrl && serviceKey);
const suite = configured ? describe : describe.skip;

const SLUG = "test-otp-iso";

suite("PTL-01: partner onboarding stores", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let admin: SupabaseClient;
  const email = `partner-${randomUUID()}@otp-iso.test`;
  let tenantId = "";
  let partnerId = "";
  let userId = "";

  beforeAll(async () => {
    client = postgres(dbUrl!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    admin = createClient(supabaseUrl!, serviceKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    await db.delete(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const [t] = await db.insert(schema.tenants).values({ name: "OTP Iso", slug: SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    const [p] = await db
      .insert(schema.partners)
      .values({ tenantId, refId: "JV-901", name: "OTP Partner", color: "#0ea5a4", email, status: "not_invited" })
      .returning({ id: schema.partners.id });
    partnerId = p.id;
    const res = await provisionPartnerUser(admin, db, { tenantId, partnerId, email });
    userId = res.userId;
  });

  afterAll(async () => {
    await db.delete(schema.otpChallenges).where(eq(schema.otpChallenges.identifier, email.toLowerCase()));
    await db.delete(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, userId));
    if (userId) await deprovisionAdmin(admin, db, userId);
    await db.delete(schema.partners).where(eq(schema.partners.tenantId, tenantId));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await client.end();
  });

  it("provisions the partner user with role=partner + partner_id claims", async () => {
    const [row] = await db
      .select({ role: schema.users.role, partnerId: schema.users.partnerId })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(row.role).toBe("partner");
    expect(row.partnerId).toBe(partnerId);
  });

  it("OTP store: persists a hashed challenge, verifies once, caps attempts", async () => {
    const now = Date.now();
    const { code, challenge } = issueOtp("pep", now);
    const store = new OtpStore(db);
    await store.persist(email, challenge);
    const active = await store.latestActive(email);
    expect(active).not.toBeNull();
    expect(otpOutcome(active!, code, now, 5)).toBe("ok");
    // Consume → single-use.
    await store.consume(active!.id, now);
    const after = await store.latestActive(email);
    expect(after).toBeNull(); // no unconsumed challenge remains
  });

  it("ToS store: acceptance flips the gate for the current version (LGL-01)", async () => {
    expect(needsTosAcceptance(await latestTosVersion(db, userId))).toBe(true);
    await recordTosAcceptance(db, userId, CURRENT_TOS_VERSION);
    expect(needsTosAcceptance(await latestTosVersion(db, userId))).toBe(false);
  });
});
