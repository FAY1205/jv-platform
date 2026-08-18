import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as schema from "../../db/schema";
import type { InvitableRole } from "./team-invite";

// ─────────────────────────────────────────────────────────────────────────────
// Phase C: staff-teammate provisioning — the FOURTH and final role write-site
// (provisionSignup / provisionAdmin / provisionPartnerUser / provisionTeamMember;
// keep the count enumerable — the provisioning tests assert app_metadata parity
// across all four). Modeled on provisionSignup's compensating saga MINUS tenant
// creation: create the auth user (email pre-confirmed — the invite email proved
// address control), mirror the users row, and BURN the invite atomically inside
// one transaction; on failure the auth user is deleted so no orphan remains.
// Staff have passwords (partners are OTP-only); ToS acceptance happens at first
// login via the existing gate (tos-guard), not here — the invitee hasn't seen
// the terms yet at provisioning time.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** The invite was consumed (or revoked) by a concurrent accept between the route's
 *  verify and this transaction — single-use, first wins (the signup-code pattern). */
export class TeamInviteConsumedError extends Error {}

/** The auth user already exists for this email — the route maps it to the same
 *  uniform refusal as any other dead invite (no enumeration oracle, AUT-05). */
export class TeamEmailExistsError extends Error {}

export interface ProvisionTeamMemberParams {
  tenantId: string;
  inviteId: string;
  email: string;
  role: InvitableRole;
  password: string;
}

export async function provisionTeamMember(
  admin: SupabaseClient,
  db: DB,
  { tenantId, inviteId, email, role, password }: ProvisionTeamMemberParams,
): Promise<{ userId: string }> {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    // The invite link reached this address and was accepted — address control is proven,
    // exactly the signup-verification guarantee. Confirmed users never become sweep
    // candidates (WP-SU-2 discriminator).
    email_confirm: true,
    // partner_id deliberately absent: staff rows carry none (SCP-08 CHECK).
    app_metadata: { tenant_id: tenantId, role },
  });
  const userId = created.data.user?.id;
  if (created.error || !userId) {
    if (created.error && /already.*registered|already.*exist|email.*exists/i.test(created.error.message)) {
      throw new TeamEmailExistsError();
    }
    throw new Error(`team provisioning: could not create auth user: ${created.error?.message ?? "unknown"}`);
  }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.users).values({ id: userId, tenantId, email, role });
      // Burn the invite atomically with the seat it creates (the signup-code pattern):
      // the conditional accepted_at/revoked_at guard makes it single-use under a race.
      const burned = await tx
        .update(schema.teamInvites)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(schema.teamInvites.id, inviteId),
            eq(schema.teamInvites.tenantId, tenantId),
            isNull(schema.teamInvites.acceptedAt),
            isNull(schema.teamInvites.revokedAt),
          ),
        )
        .returning({ id: schema.teamInvites.id });
      if (burned.length === 0) throw new TeamInviteConsumedError();
      await tx.insert(schema.auditLog).values({
        tenantId,
        actorUserId: userId,
        action: "team.member_joined",
        entityType: "user",
        entityRef: userId,
        before: null,
        after: { role },
        traceId: null,
      });
    });
  } catch (e) {
    // Compensate: no users row landed, so the auth user must not linger (it would be a
    // confirmed, workspace-less login). Best-effort — a failed delete leaves a row the
    // NotProvisionedError path refuses anyway.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw e;
  }
  return { userId };
}
