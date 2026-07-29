import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import {
  sweepAbandonedSignups,
  reconcileDroppedSignups,
  SIGNUP_ABANDON_GRACE_MS,
} from "@/modules/retention/signup-sweep";
import { SIGNUP_TTL_MS } from "@/lib/auth/signup-token";

// WP-SU-2 (ADR-0033's WP-SU-1 note): never-verified public signups accumulate as
// tenant+user+auth-user+signup_verifications rows with no cleanup. sweepAbandonedSignups
// purges the ones provably abandoned (expired + unconsumed + still-unconfirmed);
// reconcileDroppedSignups catches BOTH dropped-signup shapes from ONE listUsers collect pass —
// after()-dropped orphans (unconfirmed + marked + past grace + NO users row) and partial
// provisions (same, but WITH a users row and no signup_verifications row) — deleting them and
// alerting (SEC-05: never a 200 that silently leaves a dropped signup). Fix round 2 (item 1)
// flipped partial detection off the users table onto the auth population so confirmed
// admins/partners can no longer starve it. Self-skips without DATABASE_URL (must NOT self-skip
// in this environment).
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

// Fake Supabase admin: an in-memory map of auth users (keyed by id) backs getUserById,
// deleteUser, and listUsers (single page — well under the 200 perPage real signup-sweep
// pages through). Mirrors provision-signup.test.ts's fake, extended for this WP's calls.
// app_metadata carries the signup marker provisionSignup stamps ({ tenant_id, role:"admin" }) —
// the destructive passes only ever delete an auth user that still carries it (item C).
type FakeAuthUser = {
  id: string;
  email: string;
  email_confirmed_at?: string;
  created_at: string;
  app_metadata?: Record<string, unknown>;
};

function makeFakeAdmin(users: Map<string, FakeAuthUser>) {
  const deleteUserCalls: string[] = [];
  const admin = {
    auth: {
      admin: {
        getUserById: async (uid: string) => {
          const u = users.get(uid);
          if (!u) return { data: { user: null }, error: { message: "user not found" } };
          return { data: { user: u }, error: null };
        },
        deleteUser: async (uid: string) => {
          deleteUserCalls.push(uid);
          users.delete(uid);
          return { data: {}, error: null };
        },
        listUsers: async ({ page }: { page: number; perPage: number }) => {
          if (page > 1) return { data: { users: [] }, error: null };
          return { data: { users: Array.from(users.values()) }, error: null };
        },
      },
    },
  };
  return { admin: admin as unknown as SupabaseClient, deleteUserCalls };
}

suite("WP-SU-2: abandoned/orphan-signup cleanup sweep", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const now = new Date("2026-07-17T12:00:00.000Z");
  const expired = new Date(now.getTime() - 1000); // 1s past expiry
  const notExpired = new Date(now.getTime() + SIGNUP_TTL_MS); // still well within TTL

  const tenantIds: string[] = [];
  const userIds: string[] = [];

  async function cleanup() {
    if (userIds.length) {
      await db.delete(schema.signupVerifications).where(inArray(schema.signupVerifications.userId, userIds));
      await db.delete(schema.tosAcceptances).where(inArray(schema.tosAcceptances.userId, userIds));
    }
    if (tenantIds.length) {
      await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tenantIds));
      await db.delete(schema.users).where(inArray(schema.users.tenantId, tenantIds));
      await db.delete(schema.tenants).where(inArray(schema.tenants.id, tenantIds));
    }
  }

  // Seeds a tenant + admin user + `tenant.signup_provisioned` audit row + tos_acceptances row
  // (mirrors provisionSignup's FULL row set — including the LGL-01 ToS row, item H) and, unless
  // `skipVerification` is set, a signup_verifications row. Registers a matching fake auth user
  // carrying the signup marker in app_metadata. `skipVerification` + `authCreatedAt` (past grace)
  // seed the partial-provision shape (item 1): provision tx landed but the verification row never
  // did — detected off the auth user's age, not the users row. Returns the ids to assert on.
  async function seedSignup(opts: {
    slug: string;
    expiresAt?: Date;
    usedAt?: Date;
    authConfirmedAt?: string;
    authCreatedAt?: string;
    authAppMetadata?: Record<string, unknown>;
    skipVerification?: boolean;
  }) {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const email = `${opts.slug}@example.com`;
    tenantIds.push(tenantId);
    userIds.push(userId);

    await db.insert(schema.tenants).values({ id: tenantId, name: opts.slug, slug: opts.slug });
    await db.insert(schema.users).values({ id: userId, tenantId, email, role: "admin" });
    await db.insert(schema.auditLog).values({
      tenantId,
      actorUserId: userId,
      action: "tenant.signup_provisioned",
      entityType: "tenant",
      entityRef: tenantId,
      after: { name: opts.slug },
    });
    // LGL-01: provisionSignup records ToS acceptance in the same tx (item H).
    await db.insert(schema.tosAcceptances).values({ userId, version: "2026-07-08" });
    if (!opts.skipVerification) {
      await db.insert(schema.signupVerifications).values({
        userId,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: opts.expiresAt ?? expired,
        usedAt: opts.usedAt,
      });
    }

    return {
      tenantId,
      userId,
      email,
      authUser: {
        id: userId,
        email,
        email_confirmed_at: opts.authConfirmedAt,
        created_at: opts.authCreatedAt ?? now.toISOString(),
        app_metadata: opts.authAppMetadata ?? { tenant_id: tenantId, role: "admin" },
      } satisfies FakeAuthUser,
    };
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  describe("sweepAbandonedSignups: per-tenant purge", () => {
    it("WP-SU-2: purges tenant+user+signup_verifications+audit_log and deletes the auth user when expired, unconsumed, and still unconfirmed", async () => {
      const seed = await seedSignup({ slug: `su2-abandoned-${randomUUID().slice(0, 8)}`, expiresAt: expired });
      const users = new Map([[seed.userId, seed.authUser]]); // email_confirmed_at unset ⇒ unconfirmed
      const { admin, deleteUserCalls } = makeFakeAdmin(users);

      const result = await sweepAbandonedSignups(db, admin, { tenantId: seed.tenantId, now });
      expect(result.purged).toBe(1);
      expect(result.skipped).toBe(0);
      expect(deleteUserCalls).toEqual([seed.userId]);

      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seed.tenantId));
      expect(tenantRows).toHaveLength(0);
      const userRows = await db.select().from(schema.users).where(eq(schema.users.id, seed.userId));
      expect(userRows).toHaveLength(0);
      const verRows = await db.select().from(schema.signupVerifications).where(eq(schema.signupVerifications.userId, seed.userId));
      expect(verRows).toHaveLength(0);
      const auditRows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, seed.tenantId));
      expect(auditRows).toHaveLength(0);
      // Item H: the tos_acceptances row provisionSignup wrote is purged too.
      const tosRows = await db.select().from(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, seed.userId));
      expect(tosRows).toHaveLength(0);
    });

    it("WP-SU-2 (item D/K): missing auth user (getUserById returns none) is a conservative skip — nothing deleted, counted as skipped", async () => {
      const seed = await seedSignup({ slug: `su2-missing-${randomUUID().slice(0, 8)}`, expiresAt: expired });
      // Fake admin's map deliberately does NOT contain this userId ⇒ getUserById → null.
      const { admin, deleteUserCalls } = makeFakeAdmin(new Map());

      const result = await sweepAbandonedSignups(db, admin, { tenantId: seed.tenantId, now });
      expect(result.purged).toBe(0);
      expect(result.skipped).toBe(1);
      expect(deleteUserCalls).toEqual([]); // never deletes an auth user we could not read

      // Everything survives — we do not guess when the auth user's state is unknown.
      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seed.tenantId));
      expect(tenantRows).toHaveLength(1);
      const userRows = await db.select().from(schema.users).where(eq(schema.users.id, seed.userId));
      expect(userRows).toHaveLength(1);
      const verRows = await db.select().from(schema.signupVerifications).where(eq(schema.signupVerifications.userId, seed.userId));
      expect(verRows).toHaveLength(1);
    });

    it("WP-SU-2: leaves a NON-expired unconsumed signup untouched", async () => {
      const seed = await seedSignup({ slug: `su2-fresh-${randomUUID().slice(0, 8)}`, expiresAt: notExpired });
      const users = new Map([[seed.userId, seed.authUser]]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);

      const result = await sweepAbandonedSignups(db, admin, { tenantId: seed.tenantId, now });
      expect(result.purged).toBe(0);
      expect(deleteUserCalls).toEqual([]);

      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seed.tenantId));
      expect(tenantRows).toHaveLength(1);
      const verRows = await db.select().from(schema.signupVerifications).where(eq(schema.signupVerifications.userId, seed.userId));
      expect(verRows).toHaveLength(1);
    });

    it("WP-SU-2: leaves an expired but CONSUMED signup untouched", async () => {
      const seed = await seedSignup({ slug: `su2-consumed-${randomUUID().slice(0, 8)}`, expiresAt: expired, usedAt: expired });
      const users = new Map([[seed.userId, seed.authUser]]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);

      const result = await sweepAbandonedSignups(db, admin, { tenantId: seed.tenantId, now });
      expect(result.purged).toBe(0);
      expect(deleteUserCalls).toEqual([]);

      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seed.tenantId));
      expect(tenantRows).toHaveLength(1);
    });

    it("WP-SU-2: a CONFIRMED auth user's expired verification row is normal residue — deletes the stale row but keeps the tenant/user", async () => {
      const seed = await seedSignup({
        slug: `su2-confirmed-${randomUUID().slice(0, 8)}`,
        expiresAt: expired,
        authConfirmedAt: expired.toISOString(),
      });
      const users = new Map([[seed.userId, seed.authUser]]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);

      const result = await sweepAbandonedSignups(db, admin, { tenantId: seed.tenantId, now });
      expect(result.purged).toBe(0);
      expect(deleteUserCalls).toEqual([]); // never deletes a confirmed user's auth account

      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seed.tenantId));
      expect(tenantRows).toHaveLength(1); // tenant survives
      const userRows = await db.select().from(schema.users).where(eq(schema.users.id, seed.userId));
      expect(userRows).toHaveLength(1); // user survives
      const verRows = await db.select().from(schema.signupVerifications).where(eq(schema.signupVerifications.userId, seed.userId));
      expect(verRows).toHaveLength(0); // only the stale verification row is cleared
      // Item H: a non-purged tenant keeps its ToS acceptance row.
      const tosRows = await db.select().from(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, seed.userId));
      expect(tosRows).toHaveLength(1);
    });

    it("PRN-08: never touches another tenant's eligible signup", async () => {
      const seedA = await seedSignup({ slug: `su2-isoA-${randomUUID().slice(0, 8)}`, expiresAt: expired });
      const seedB = await seedSignup({ slug: `su2-isoB-${randomUUID().slice(0, 8)}`, expiresAt: expired });
      const users = new Map([
        [seedA.userId, seedA.authUser],
        [seedB.userId, seedB.authUser],
      ]);
      const { admin } = makeFakeAdmin(users);

      await sweepAbandonedSignups(db, admin, { tenantId: seedA.tenantId, now });

      const tenantB = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seedB.tenantId));
      expect(tenantB).toHaveLength(1); // tenant B untouched by tenant A's sweep
    });

    it("idempotent: a second sweep on an already-purged tenant purges nothing", async () => {
      const seed = await seedSignup({ slug: `su2-idempotent-${randomUUID().slice(0, 8)}`, expiresAt: expired });
      const users = new Map([[seed.userId, seed.authUser]]);
      const { admin } = makeFakeAdmin(users);

      const first = await sweepAbandonedSignups(db, admin, { tenantId: seed.tenantId, now });
      expect(first.purged).toBe(1);
      const second = await sweepAbandonedSignups(db, admin, { tenantId: seed.tenantId, now });
      expect(second.purged).toBe(0);
    });
  });

  describe("reconcileDroppedSignups: after()-dropped orphans", () => {
    it("WP-SU-2: deletes an unconfirmed auth user older than grace with NO matching users row, and alerts via logError", async () => {
      const orphanId = randomUUID();
      const orphanCreatedAt = new Date(now.getTime() - SIGNUP_ABANDON_GRACE_MS - 1000).toISOString(); // just past grace
      const users = new Map<string, FakeAuthUser>([
        [orphanId, { id: orphanId, email: "orphan@example.com", created_at: orphanCreatedAt, app_metadata: { tenant_id: randomUUID(), role: "admin" } }],
      ]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await reconcileDroppedSignups(db, admin, { now });

      expect(result.orphans).toBe(1);
      expect(result.partials).toBe(0);
      expect(deleteUserCalls).toEqual([orphanId]);
      const alertLine = consoleSpy.mock.calls.map((c) => c[0] as string).find((l) => l.includes("signup_orphan_reconciled"));
      expect(alertLine).toBeDefined();
      const parsed = JSON.parse(alertLine!);
      expect(parsed).toMatchObject({ code: "signup_orphan_reconciled", count: 1 });
      consoleSpy.mockRestore();
    });

    it("WP-SU-2: does NOT treat an unconfirmed auth user still inside the grace window as an orphan", async () => {
      const recentId = randomUUID();
      const users = new Map<string, FakeAuthUser>([
        [recentId, { id: recentId, email: "recent@example.com", created_at: new Date(now.getTime() - 1000).toISOString(), app_metadata: { tenant_id: randomUUID(), role: "admin" } }],
      ]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await reconcileDroppedSignups(db, admin, { now });

      expect(result.orphans).toBe(0);
      expect(deleteUserCalls).toEqual([]);
      consoleSpy.mockRestore();
    });

    it("WP-SU-2: does NOT treat an unconfirmed auth user as an orphan when it HAS a matching users row (and a verification row ⇒ owned by the abandoned sweep)", async () => {
      const seed = await seedSignup({ slug: `su2-notorphan-${randomUUID().slice(0, 8)}`, expiresAt: notExpired });
      const oldEnough = new Date(now.getTime() - SIGNUP_ABANDON_GRACE_MS - 1000).toISOString();
      const users = new Map<string, FakeAuthUser>([[seed.userId, { ...seed.authUser, created_at: oldEnough }]]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await reconcileDroppedSignups(db, admin, { now });

      expect(result.orphans).toBe(0);
      expect(result.partials).toBe(0); // has a verification row ⇒ NOT a partial either
      expect(deleteUserCalls).toEqual([]); // has a users row ⇒ not an orphan, never deleted
      consoleSpy.mockRestore();
    });

    it("WP-SU-2: does not alert when there are no orphans", async () => {
      const users = new Map<string, FakeAuthUser>();
      const { admin } = makeFakeAdmin(users);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await reconcileDroppedSignups(db, admin, { now });

      expect(result.orphans).toBe(0);
      const alertLine = consoleSpy.mock.calls.map((c) => c[0] as string).find((l) => l.includes("signup_orphan_reconciled"));
      expect(alertLine).toBeUndefined();
      consoleSpy.mockRestore();
    });

    it("WP-SU-2 (item C): an unconfirmed auth user past grace with NO signup marker is left alone (a non-signup account is not ours to delete)", async () => {
      const strangerId = randomUUID();
      const oldEnough = new Date(now.getTime() - SIGNUP_ABANDON_GRACE_MS - 1000).toISOString();
      const users = new Map<string, FakeAuthUser>([
        // Unconfirmed + past grace + no users row, but app_metadata carries NO signup marker.
        [strangerId, { id: strangerId, email: "stranger@example.com", created_at: oldEnough, app_metadata: {} }],
      ]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await reconcileDroppedSignups(db, admin, { now });

      expect(result.orphans).toBe(0);
      expect(result.partials).toBe(0);
      expect(deleteUserCalls).toEqual([]); // no marker ⇒ not a signup orphan ⇒ never deleted
      consoleSpy.mockRestore();
    });

    it("WP-SU-2 (item E): alerts signup_orphan_reconcile_paging_truncated when the 20-page bound is hit with a still-full last page", async () => {
      // A fake admin that returns 20 FULL pages (200 each) of confirmed users — no orphan is
      // deleted (they are confirmed), but the last page is still full, so the paging bound was
      // hit and more users may exist beyond it: the truncation signal must fire.
      const deleteUserCalls: string[] = [];
      const fullAdmin = {
        auth: {
          admin: {
            getUserById: async () => ({ data: { user: null }, error: { message: "unused" } }),
            deleteUser: async (uid: string) => {
              deleteUserCalls.push(uid);
              return { data: {}, error: null };
            },
            listUsers: async ({ page }: { page: number; perPage: number }) => {
              if (page > 20) return { data: { users: [] }, error: null };
              const users = Array.from({ length: 200 }, () => ({
                id: randomUUID(),
                email: "full@example.com",
                email_confirmed_at: now.toISOString(), // confirmed ⇒ not an orphan
                created_at: now.toISOString(),
              }));
              return { data: { users }, error: null };
            },
          },
        },
      } as unknown as SupabaseClient;
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await reconcileDroppedSignups(db, fullAdmin, { now });

      expect(result.orphans).toBe(0);
      expect(result.partials).toBe(0);
      expect(deleteUserCalls).toEqual([]);
      const truncLine = consoleSpy.mock.calls
        .map((c) => c[0] as string)
        .find((l) => l.includes("signup_orphan_reconcile_paging_truncated"));
      expect(truncLine).toBeDefined();
      expect(JSON.parse(truncLine!)).toMatchObject({ code: "signup_orphan_reconcile_paging_truncated", page: 20 });
      consoleSpy.mockRestore();
    });
  });

  describe("reconcileDroppedSignups: partial provisions (users row exists, verification row never did)", () => {
    // A partial is detected off the AUTH user's created_at (past grace) + marker + unconfirmed +
    // a users row + NO verification row — NOT off users.createdAt. authCreatedAt drives eligibility.
    const pastGrace = new Date(now.getTime() - SIGNUP_ABANDON_GRACE_MS - 1000).toISOString();

    it("WP-SU-2 (item 1): purges a tenant+user with NO verification row, past grace, unconfirmed + marked — and alerts", async () => {
      const seed = await seedSignup({
        slug: `su2-partial-${randomUUID().slice(0, 8)}`,
        skipVerification: true,
        authCreatedAt: pastGrace, // auth user past grace ⇒ eligible (no oldest-row fixture needed)
      });
      const users = new Map([[seed.userId, seed.authUser]]); // unconfirmed, carries the marker
      const { admin, deleteUserCalls } = makeFakeAdmin(users);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await reconcileDroppedSignups(db, admin, { now });

      expect(result.partials).toBe(1);
      expect(result.orphans).toBe(0);
      expect(deleteUserCalls).toContain(seed.userId);

      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seed.tenantId));
      expect(tenantRows).toHaveLength(0);
      const userRows = await db.select().from(schema.users).where(eq(schema.users.id, seed.userId));
      expect(userRows).toHaveLength(0);
      const auditRows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, seed.tenantId));
      expect(auditRows).toHaveLength(0);
      const tosRows = await db.select().from(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, seed.userId));
      expect(tosRows).toHaveLength(0);

      const alertLine = consoleSpy.mock.calls
        .map((c) => c[0] as string)
        .find((l) => l.includes("signup_partial_provision_reconciled"));
      expect(alertLine).toBeDefined();
      expect(JSON.parse(alertLine!)).toMatchObject({ code: "signup_partial_provision_reconciled", count: 1 });
      consoleSpy.mockRestore();
    });

    it("WP-SU-2 (item 1): a CONFIRMED user with no verification row is left untouched", async () => {
      const seed = await seedSignup({
        slug: `su2-partialconf-${randomUUID().slice(0, 8)}`,
        skipVerification: true,
        authCreatedAt: pastGrace,
        authConfirmedAt: expired.toISOString(),
      });
      const users = new Map([[seed.userId, seed.authUser]]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);

      const result = await reconcileDroppedSignups(db, admin, { now });
      expect(result.partials).toBe(0);

      expect(deleteUserCalls).not.toContain(seed.userId); // confirmed ⇒ a real account, never touched
      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seed.tenantId));
      expect(tenantRows).toHaveLength(1);
      const userRows = await db.select().from(schema.users).where(eq(schema.users.id, seed.userId));
      expect(userRows).toHaveLength(1);
    });

    it("WP-SU-2 (item 1): a FRESH (within-grace) user with no verification row is not yet eligible", async () => {
      const seed = await seedSignup({
        slug: `su2-partialfresh-${randomUUID().slice(0, 8)}`,
        skipVerification: true,
        // authCreatedAt defaults to `now` ⇒ auth user inside the grace window ⇒ not a candidate
      });
      const users = new Map([[seed.userId, seed.authUser]]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);

      const result = await reconcileDroppedSignups(db, admin, { now });

      expect(result.partials).toBe(0);
      expect(deleteUserCalls).not.toContain(seed.userId); // still inside grace ⇒ not a candidate
      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seed.tenantId));
      expect(tenantRows).toHaveLength(1);
    });

    it("WP-SU-2 (item 2, N-3): an UNMARKED unconfirmed user past grace WITH a users row and no verification row is NOT purged", async () => {
      const seed = await seedSignup({
        slug: `su2-partialunmarked-${randomUUID().slice(0, 8)}`,
        skipVerification: true,
        authCreatedAt: pastGrace,
        authAppMetadata: {}, // no signup marker ⇒ not a dropped signup, whatever its age
      });
      const users = new Map([[seed.userId, seed.authUser]]);
      const { admin, deleteUserCalls } = makeFakeAdmin(users);

      const result = await reconcileDroppedSignups(db, admin, { now });

      expect(result.partials).toBe(0);
      expect(deleteUserCalls).not.toContain(seed.userId);
      const tenantRows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, seed.tenantId));
      expect(tenantRows).toHaveLength(1); // rows survive — never guess-delete an unmarked account
      const userRows = await db.select().from(schema.users).where(eq(schema.users.id, seed.userId));
      expect(userRows).toHaveLength(1);
      const tosRows = await db.select().from(schema.tosAcceptances).where(eq(schema.tosAcceptances.userId, seed.userId));
      expect(tosRows).toHaveLength(1);
    });

    it("WP-SU-2 (item 1, starvation regression): a RECENT partial is still found among OLDER confirmed accounts with no verification rows", async () => {
      // The old users-table LEFT JOIN query (oldest-first, LIMIT 200) would be permanently
      // saturated by confirmed admins/partners — who also have no verification row — starving a
      // genuine recent partial. Detecting off the auth population filters the confirmed ones out
      // by email_confirmed_at, so the recent partial is examined regardless of how many exist.
      const older = new Date(now.getTime() - SIGNUP_ABANDON_GRACE_MS - 100_000).toISOString();
      const confirmed = [];
      for (let i = 0; i < 3; i++) {
        confirmed.push(
          await seedSignup({
            slug: `su2-starveconf${i}-${randomUUID().slice(0, 8)}`,
            skipVerification: true,
            authConfirmedAt: expired.toISOString(),
            authCreatedAt: older, // older than the partial — would sort ahead in an oldest-first LIMIT
          }),
        );
      }
      const partial = await seedSignup({
        slug: `su2-starvepartial-${randomUUID().slice(0, 8)}`,
        skipVerification: true,
        authCreatedAt: pastGrace, // more recent than the confirmed accounts, still past grace
      });
      const map = new Map<string, FakeAuthUser>();
      for (const c of confirmed) map.set(c.userId, c.authUser);
      map.set(partial.userId, partial.authUser);
      const { admin, deleteUserCalls } = makeFakeAdmin(map);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await reconcileDroppedSignups(db, admin, { now });

      expect(result.partials).toBe(1); // the recent partial, not starved by the confirmed accounts
      expect(deleteUserCalls).toEqual([partial.userId]);
      const partialTenant = await db.select().from(schema.tenants).where(eq(schema.tenants.id, partial.tenantId));
      expect(partialTenant).toHaveLength(0); // purged
      for (const c of confirmed) {
        const rows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, c.tenantId));
        expect(rows).toHaveLength(1); // confirmed accounts untouched
      }
      consoleSpy.mockRestore();
    });
  });
});
