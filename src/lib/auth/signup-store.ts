import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { SignupTokenRecord } from "./signup-token";

// SCP-02/AUT-06: persistence for signup email-verification tokens. Only the hash
// is stored; the secret exists only in the email. Server-managed (service role).

type DB = PostgresJsDatabase<typeof schema>;

export type StoredSignupToken = SignupTokenRecord & { id: string };

export class SignupStore {
  constructor(private db: DB) {}

  async persist(rec: SignupTokenRecord): Promise<void> {
    await this.db.insert(schema.signupVerifications).values({
      userId: rec.userId,
      tokenHash: rec.tokenHash,
      expiresAt: new Date(rec.expiresAt),
    });
  }

  async findByHash(tokenHash: string): Promise<StoredSignupToken | null> {
    const [row] = await this.db
      .select()
      .from(schema.signupVerifications)
      .where(eq(schema.signupVerifications.tokenHash, tokenHash));
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: new Date(row.expiresAt).getTime(),
      usedAt: row.usedAt ? new Date(row.usedAt).getTime() : undefined,
    };
  }

  async markUsed(id: string, usedAt: number): Promise<void> {
    await this.db
      .update(schema.signupVerifications)
      .set({ usedAt: new Date(usedAt) })
      .where(eq(schema.signupVerifications.id, id));
  }

  /**
   * WP-B (resend): replace every verification row for a user with a single fresh one,
   * atomically. Keeping exactly one row per user is load-bearing for the sweep — a
   * rotated (unexpired) row means the user is no longer a purge candidate, so a resend
   * can never race the abandoned-signup sweep into deleting a live pending signup. The
   * old token's hash is gone, so the previous email link stops working (single active
   * link at a time). Only ever called for an existing unconfirmed signup.
   */
  async rotate(rec: SignupTokenRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.signupVerifications).where(eq(schema.signupVerifications.userId, rec.userId));
      await tx.insert(schema.signupVerifications).values({
        userId: rec.userId,
        tokenHash: rec.tokenHash,
        expiresAt: new Date(rec.expiresAt),
      });
    });
  }
}
