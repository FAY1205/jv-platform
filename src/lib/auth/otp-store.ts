import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { OtpChallenge } from "./otp";
import type { OtpChallengeState } from "./otp-verify";

// PTL-01: persistence for partner email-OTP challenges. Only the code hash + pepper
// are stored (0006 migration). Server-managed via the service role.

type DB = PostgresJsDatabase<typeof schema>;

export type StoredOtp = OtpChallengeState & { id: string };

export class OtpStore {
  constructor(private db: DB) {}

  async persist(identifier: string, challenge: OtpChallenge): Promise<void> {
    await this.db.insert(schema.otpChallenges).values({
      identifier: identifier.toLowerCase(),
      codeHash: challenge.codeHash,
      pepper: challenge.pepper,
      expiresAt: new Date(challenge.expiresAt),
    });
  }

  /** The most recent unconsumed challenge for an identifier, or null. */
  async latestActive(identifier: string): Promise<StoredOtp | null> {
    const C = schema.otpChallenges;
    const [row] = await this.db
      .select()
      .from(C)
      .where(and(eq(C.identifier, identifier.toLowerCase()), isNull(C.consumedAt)))
      .orderBy(desc(C.createdAt))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      codeHash: row.codeHash,
      pepper: row.pepper,
      expiresAt: new Date(row.expiresAt).getTime(),
      attemptCount: row.attemptCount,
      consumedAt: row.consumedAt ? new Date(row.consumedAt).getTime() : undefined,
    };
  }

  async incrementAttempt(id: string): Promise<void> {
    const C = schema.otpChallenges;
    await this.db
      .update(C)
      .set({ attemptCount: sql`${C.attemptCount} + 1` })
      .where(eq(C.id, id));
  }

  async consume(id: string, now: number): Promise<void> {
    await this.db
      .update(schema.otpChallenges)
      .set({ consumedAt: new Date(now) })
      .where(eq(schema.otpChallenges.id, id));
  }
}
