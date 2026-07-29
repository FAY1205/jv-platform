import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { provisionAdmin, provisionPartnerUser } from "@/lib/auth/provision";

// WP-SU-2 fix round 2 (item 3, security N-4): every non-signup provisioning path must
// UNCONDITIONALLY confirm the auth user's email. provisionSignup is the ONLY createUser path
// that leaves email_confirm:false; the sweep's "unconfirmed + signup marker ⇒ delete" rule
// rests on that invariant. The already-registered UPDATE branches (createUser failed → find +
// updateUserById) must therefore also force email_confirm:true, or a re-provisioned admin/
// partner could linger unconfirmed and become a false sweep candidate.
//
// Pure unit test: fakes the Supabase admin (createUser fails ⇒ update branch) and the db
// mirror, and captures the updateUserById payload. No DB / DATABASE_URL needed.

const fakeDb = {
  insert: () => ({
    values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
  }),
} as unknown as PostgresJsDatabase<typeof schema>;

function makeUpdateBranchAdmin(email: string) {
  const updateCalls: { uid: string; payload: Record<string, unknown> }[] = [];
  const admin = {
    auth: {
      admin: {
        // createUser fails ⇒ provisionAdmin/provisionPartnerUser fall into the update branch.
        createUser: async () => ({ data: { user: null }, error: { message: "already registered" } }),
        listUsers: async ({ page }: { page: number; perPage: number }) => {
          if (page > 1) return { data: { users: [] }, error: null };
          return { data: { users: [{ id: "existing-uid", email }] }, error: null };
        },
        updateUserById: async (uid: string, payload: Record<string, unknown>) => {
          updateCalls.push({ uid, payload });
          return { data: { user: { id: uid } }, error: null };
        },
      },
    },
  } as unknown as SupabaseClient;
  return { admin, updateCalls };
}

describe("provision.ts: already-registered update branches force email_confirm", () => {
  it("AUT-05 (item 3): provisionAdmin's update branch sets email_confirm:true", async () => {
    const email = "dup-admin@example.com";
    const { admin, updateCalls } = makeUpdateBranchAdmin(email);

    const res = await provisionAdmin(admin, fakeDb, { tenantId: "t1", email, password: "pw" });

    expect(res.created).toBe(false); // took the update branch
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].uid).toBe("existing-uid");
    expect(updateCalls[0].payload).toMatchObject({ email_confirm: true });
  });

  it("AUT-05 (item 3): provisionPartnerUser's update branch sets email_confirm:true", async () => {
    const email = "dup-partner@example.com";
    const { admin, updateCalls } = makeUpdateBranchAdmin(email);

    const res = await provisionPartnerUser(admin, fakeDb, { tenantId: "t1", partnerId: "p1", email });

    expect(res.created).toBe(false);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({ email_confirm: true });
  });
});
